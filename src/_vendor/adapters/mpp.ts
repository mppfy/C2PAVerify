// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

/**
 * MPPAdapter — Machine Payments Protocol adapter.
 *
 * Protocol: MPP (Machine Payments Protocol)
 * Network: Tempo chain
 * Settlement: USDC-like TIP-20 token on Tempo
 * SDK: mppx (https://github.com/wevm/mppx)
 *
 * Integration notes:
 * - `Mppx.create({ methods, secretKey })` создается один раз на adapter.
 * - `mppx.charge({ amount })(request)` атомарно проверяет платеж И
 *   генерирует 402 challenge. Два отдельных вызова — нельзя.
 * - Adapter interface делит эти шаги (verify → create402 → attachReceipt).
 *   Поэтому результат вызова stash-им в WeakMap<Request, MppxResult>
 *   внутри замыкания adapter и переиспользуем между шагами.
 */

import { Mppx, tempo } from 'mppx/server';
import type {
  PaymentAdapter,
  PaymentRequirement,
  PaymentVerification,
  Payment402Payload,
} from './types';

// TIP-20 (USD-pegged) currency addresses на Tempo chain.
const TEMPO_USD_MAINNET = '0x20c000000000000000000000b9537d11c60e8b50' as const;
const TEMPO_USD_TESTNET = '0x20c0000000000000000000000000000000000000' as const;

/** Shape возвращаемого значения mppx.charge(...)(request) */
interface MppxChargeResult {
  readonly status: number;
  readonly challenge: Response;
  withReceipt(response: Response): Response;
}

export interface MPPAdapterConfig {
  /** Адрес для получения платежей (0x...) */
  recipientAddress: string;

  /** 32-byte secret key (base64) для binding challenges к серверу. */
  secretKey: string;

  /** testnet (true) или mainnet (false) */
  testnet: boolean;

  /** Realm для challenges. Default: hostname from request. */
  realm?: string;

  /**
   * Private key Tempo wallet для fee-payer flows.
   * Пока не используется — оставлено для v2 (fee sponsorship).
   */
  walletPrivateKey?: string;
}

/**
 * Фабрика для создания MPP adapter с конфигурацией.
 * Configuration передается извне для testability.
 */
export function createMPPAdapter(config: MPPAdapterConfig): PaymentAdapter {
  const currency = config.testnet ? TEMPO_USD_TESTNET : TEMPO_USD_MAINNET;

  // Один Mppx instance на adapter. `tempo.charge(...)` описывает метод,
  // который `mppx.charge({amount})(req)` использует при каждом запросе.
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        currency,
        recipient: config.recipientAddress as `0x${string}`,
        testnet: config.testnet,
      }),
    ],
    secretKey: config.secretKey,
    ...(config.realm ? { realm: config.realm } : {}),
  });

  // State между verify() и create402()/attachReceipt() в пределах одного request.
  // WeakMap — GC-friendly, request object освобождается после обработки.
  const pending = new WeakMap<Request, MppxChargeResult>();

  return {
    name: 'mpp',

    detects(request: Request): boolean {
      // MPP использует стандартный HTTP auth scheme `Payment`.
      // См. src/Credential.ts в mppx: `Authorization: Payment <base64url>`.
      const auth = request.headers.get('authorization');
      return auth !== null && /^Payment\s+/i.test(auth);
    },

    async verify(
      request: Request,
      requirement: PaymentRequirement,
    ): Promise<PaymentVerification | null> {
      const result = (await mppx.charge({
        amount: requirement.amount,
        description: `Service: ${requirement.serviceId}`,
      })(request)) as unknown as MppxChargeResult;

      // Stash для create402/attachReceipt — используем оригинальный request
      // как ключ. Hono пробрасывает c.req.raw без копирования.
      pending.set(request, result);

      if (result.status === 402) {
        // Нет/невалидный платеж — routes вызовет create402() следом.
        return null;
      }

      return {
        verified: true,
        protocol: 'mpp',
        amount: requirement.amount,
        metadata: { mppxResult: result, status: result.status },
      };
    },

    create402(requirement: PaymentRequirement, request: Request): Response {
      // Fast path: у mppx уже есть сгенерированный challenge с правильным
      // WWW-Authenticate и signed challengeId. Отдаем его как есть.
      const stashed = pending.get(request);
      if (stashed && stashed.status === 402) {
        pending.delete(request);
        return stashed.challenge;
      }

      // Fallback — если create402 вызван без предшествующего verify().
      // Этого не должно случаться в нашем flow, но чтобы interface
      // был honest — возвращаем совместимый JSON 402.
      const payload: Payment402Payload = {
        error: 'payment_required',
        protocol: 'mpp',
        amount: requirement.amount,
        currency: requirement.currency,
        recipient: requirement.recipient,
        network: 'tempo',
        service_id: requirement.serviceId,
        retry_with_payment:
          'Pay via MPP protocol. Use mppx SDK or send Authorization: Payment <credential> header.',
        extra: {
          testnet: config.testnet,
          currency_contract: currency,
          protocol_url: 'https://mpp.dev',
        },
      };

      return new Response(JSON.stringify(payload, null, 2), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'x-payment-protocol': 'mpp',
          'x-payment-amount': requirement.amount,
          'x-payment-recipient': requirement.recipient,
          'x-payment-network': 'tempo',
        },
      });
    },

    attachReceipt(
      response: Response,
      verification: PaymentVerification,
    ): Response {
      const mppxResult = verification.metadata?.mppxResult as
        | MppxChargeResult
        | undefined;

      if (mppxResult && typeof mppxResult.withReceipt === 'function') {
        // SDK сам добавит signed receipt header + любые нужные поля.
        return mppxResult.withReceipt(response);
      }

      // Fallback — adapter был вызван без mppx-результата в metadata.
      // Сохраняем body, добавляем минимальные marker headers.
      const headers = new Headers(response.headers);
      headers.set('x-payment-protocol', 'mpp');
      if (verification.amount) {
        headers.set('x-payment-amount', verification.amount);
      }
      if (verification.txHash) {
        headers.set('x-payment-tx-hash', verification.txHash);
      }
      if (verification.payerAddress) {
        headers.set('x-payment-payer', verification.payerAddress);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}
