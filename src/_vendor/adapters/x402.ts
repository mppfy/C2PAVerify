// VENDOR: C2PAVerify-specific module. Not yet in mppfy/platform core.
// Extract to @mppfy/platform-core after x402 feature is merged.

/**
 * X402Adapter — x402 Payment Protocol adapter.
 *
 * Protocol: x402 (Coinbase-backed, Base chain settlement)
 * Network: Base mainnet (prod) / Base Sepolia (staging)
 * Settlement: USDC ERC-20 via EIP-3009 `transferWithAuthorization`
 * SDK: `x402` npm v1.1.0 (https://github.com/coinbase/x402)
 *
 * Wire protocol (from x402-hono@1.1.0 reference middleware):
 * - Client with no payment →  we reply 402 + JSON body { error, accepts: PaymentRequirements[], x402Version: 1 }
 * - Client with payment   →  sends `X-PAYMENT: <base64(PaymentPayload)>` header
 * - Server verifies       →  POST https://x402.org/facilitator/verify { paymentPayload, paymentRequirements }
 * - Server settles        →  POST /settle; on success returns 200 + `X-PAYMENT-RESPONSE: <base64(SettleResponse)>`
 *
 * Integration notes:
 * - Adapter interface separates verify() from attachReceipt(). x402 requires
 *   settle() call at receipt-attach time to trigger on-chain USDC movement.
 * - verify() decodes X-PAYMENT + calls facilitator.verify() only.
 * - attachReceipt() calls facilitator.settle() and emits X-PAYMENT-RESPONSE.
 *   If settle fails, receipt is missing — caller should treat 200 without
 *   receipt as a warning (agent can retry payment).
 * - We stash decoded payload + requirements in WeakMap<Request> to avoid
 *   re-decoding between verify/settle phases.
 */

import { exact } from 'x402/schemes';
import { settleResponseHeader } from 'x402/types';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  Network,
} from 'x402/types';
import type {
  PaymentAdapter,
  PaymentRequirement,
  PaymentVerification,
} from './types';
import {
  createFacilitatorClient,
  type X402FacilitatorClient,
} from './x402-facilitator';

// USDC contracts on supported networks (EIP-712 signing domain).
// Addresses from https://developers.circle.com/stablecoins/docs/usdc-on-main-networks
const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// EIP-712 domain metadata. Required by facilitator to verify signature.
// USDC on Base uses `name="USD Coin"`, `version="2"`.
const USDC_EIP712 = { name: 'USD Coin', version: '2' } as const;

export interface X402AdapterConfig {
  /** Base EOA to receive USDC payments. */
  recipientAddress: string;

  /** Target network. Defaults to base-sepolia for staging safety. */
  network: 'base' | 'base-sepolia';

  /** Facilitator URL. Defaults to public x402.org/facilitator. */
  facilitatorUrl?: string;

  /**
   * Fallback facilitator URL if primary fails/timeouts. Defaults to
   * `https://x402.org/facilitator` (no-auth public). Disable fallback by
   * explicitly passing the same URL as `facilitatorUrl`.
   */
  facilitatorFallbackUrl?: string;

  /**
   * Per-call facilitator timeout in ms. Single value applies to verify
   * (tight, so agent MPP fallback kicks in faster) — settle uses a wider
   * internal default. Override for stress-testing / degraded upstream
   * experiments.
   */
  facilitatorTimeoutMs?: number;

  /**
   * Optional asset contract override. Falls back to USDC for the chosen
   * network (base → USDC_BASE_MAINNET; base-sepolia → USDC_BASE_SEPOLIA).
   * Use for non-USDC experiments.
   */
  assetAddress?: string;

  /**
   * Payer addresses to mark as seed / self-test traffic (lowercase EVM).
   * Settlements from these payers are still executed normally on-chain,
   * but tagged in observability so demand-signal metrics can filter
   * organic vs seed. Populated from env `X402_SEED_PAYERS` (comma-list).
   *
   * See docs/x402-roadmap.md — "seed payment" section.
   */
  seedPayers?: readonly string[];
}

/** Stash between verify() and attachReceipt() — see mpp.ts for rationale. */
interface PendingPayment {
  readonly decoded: PaymentPayload;
  readonly requirements: PaymentRequirements;
}

/**
 * Build concrete PaymentRequirements from abstract PaymentRequirement.
 * Pure function — no I/O, easy to test.
 */
export function buildX402Requirements(params: {
  amountDecimalUsd: string; // "0.01"
  recipientAddress: string;
  network: 'base' | 'base-sepolia';
  assetAddress: string;
  resourceUrl: string;
  description: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  discoverable?: boolean;
}): PaymentRequirements {
  // USDC has 6 decimals. "0.01" → "10000" atomic units.
  const atomicAmount = Math.round(parseFloat(params.amountDecimalUsd) * 1_000_000).toString();

  return {
    scheme: 'exact',
    network: params.network as Network,
    maxAmountRequired: atomicAmount,
    resource: params.resourceUrl as `${string}://${string}`,
    description: params.description,
    mimeType: params.mimeType ?? 'application/json',
    payTo: params.recipientAddress,
    maxTimeoutSeconds: params.maxTimeoutSeconds ?? 300,
    asset: params.assetAddress,
    outputSchema: {
      input: {
        type: 'http',
        method: 'POST',
        discoverable: params.discoverable ?? true,
      },
    },
    extra: { ...USDC_EIP712 },
  };
}

export function createX402Adapter(config: X402AdapterConfig): PaymentAdapter {
  const facilitator: X402FacilitatorClient = createFacilitatorClient({
    url: config.facilitatorUrl ?? 'https://x402.org/facilitator',
    ...(config.facilitatorFallbackUrl
      ? { fallbackUrl: config.facilitatorFallbackUrl }
      : {}),
    ...(config.facilitatorTimeoutMs !== undefined
      ? { timeoutMs: config.facilitatorTimeoutMs }
      : {}),
  });

  const assetAddress =
    config.assetAddress ??
    (config.network === 'base' ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA);

  const pending = new WeakMap<Request, PendingPayment>();

  // Normalize seed payers to lowercase — EVM addresses are case-insensitive
  // but comparisons need to be uniform. Empty set = no seed tagging.
  const seedPayers = new Set(
    (config.seedPayers ?? []).map(a => a.toLowerCase()),
  );

  return {
    name: 'x402',

    detects(request: Request): boolean {
      // x402 clients send the signed payload in X-PAYMENT.
      return request.headers.get('x-payment') !== null;
    },

    async verify(
      request: Request,
      requirement: PaymentRequirement,
    ): Promise<PaymentVerification | null> {
      const paymentHeader = request.headers.get('x-payment');
      if (!paymentHeader) {
        // No payment — caller creates 402 via create402().
        return null;
      }

      // Decode base64 JSON payment payload from client.
      let decoded: PaymentPayload;
      try {
        decoded = exact.evm.decodePayment(paymentHeader);
      } catch (err) {
        console.error('[x402] decode error:', err);
        return null;
      }

      // Build the requirements this request must satisfy.
      const requirements = buildX402Requirements({
        amountDecimalUsd: requirement.amount,
        recipientAddress: requirement.recipient,
        network: config.network,
        assetAddress,
        resourceUrl: new URL(request.url).toString(),
        description: `Service: ${requirement.serviceId}`,
      });

      // Delegate cryptographic + on-chain eligibility checks to facilitator.
      const result = await facilitator.verify(decoded, requirements);
      if (!result.isValid) {
        console.warn('[x402] verify rejected:', result.invalidReason);
        return null;
      }

      // Stash for attachReceipt → settle().
      pending.set(request, { decoded, requirements });

      // Tag source for demand-signal hygiene. `seed` = our own test
      // payments (excluded from organic metrics). `organic` = anyone else.
      const payerLower = result.payer?.toLowerCase() ?? '';
      const source: 'seed' | 'organic' =
        payerLower && seedPayers.has(payerLower) ? 'seed' : 'organic';

      return {
        verified: true,
        protocol: 'x402',
        amount: requirement.amount,
        payerAddress: result.payer,
        metadata: {
          network: config.network,
          scheme: 'exact',
          source,
        },
      };
    },

    create402(requirement: PaymentRequirement, request: Request): Response {
      // Issue challenge per x402 v1 spec: 402 + { error, accepts, x402Version }.
      // No special headers — just JSON body. Same as x402-hono middleware.
      const requirements = buildX402Requirements({
        amountDecimalUsd: requirement.amount,
        recipientAddress: requirement.recipient,
        network: config.network,
        assetAddress,
        resourceUrl: new URL(request.url).toString(),
        description: `Service: ${requirement.serviceId}`,
      });

      const body = {
        x402Version: 1 as const,
        error: 'X-PAYMENT header is required',
        accepts: [requirements],
      };

      return new Response(JSON.stringify(body, null, 2), {
        status: 402,
        headers: {
          'content-type': 'application/json',
          'x-payment-protocol': 'x402',
        },
      });
    },

    attachReceipt(
      response: Response,
      verification: PaymentVerification,
    ): Response {
      // Sync markers only — actual on-chain settlement happens in settle()
      // below, which is async. These headers are still useful if settle()
      // is a no-op (e.g. dev mode) or if the caller skips settle for some
      // reason: at minimum the client learns which protocol + network
      // served the payment.
      const headers = new Headers(response.headers);
      headers.set('x-payment-protocol', 'x402');
      headers.set('x-payment-network', config.network);
      if (verification.payerAddress) {
        headers.set('x-payment-payer', verification.payerAddress);
      }
      if (verification.amount) {
        headers.set('x-payment-amount', verification.amount);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },

    async settle(
      request: Request,
      response: Response,
      verification: PaymentVerification,
    ): Promise<Response> {
      // Only act on 2xx responses — a 4xx/5xx handler outcome should NOT
      // trigger on-chain USDC movement. Facilitator would accept it, but
      // charging the agent for a failed call is hostile.
      if (response.status < 200 || response.status >= 300) {
        return response;
      }

      const stash = pending.get(request);
      if (!stash) {
        // verify() never stashed — either this Request isn't an x402 one,
        // or verify() was called on a different Request instance. No-op.
        console.warn('[x402] settle called without matching verify() stash');
        return response;
      }

      const source = verification.metadata?.source ?? 'organic';

      let settlement: SettleResponse;
      try {
        settlement = await facilitator.settle(stash.decoded, stash.requirements);
      } catch (err) {
        console.error(
          `[x402] settle threw (source=${source}, payer=${verification.payerAddress}):`,
          err,
        );
        return response;
      }
      if (!settlement.success) {
        console.error(
          `[x402] settle failed (source=${source}, payer=${verification.payerAddress}):`,
          settlement.errorReason,
        );
        return response;
      }

      // Observability: one structured line per settled payment. Easy grep
      // in CF logs (`source=seed` / `source=organic`). Analytics Engine
      // still gets the signal via wrapHandler's verification.metadata.
      console.log(
        `[x402] settled source=${source} payer=${verification.payerAddress} tx=${settlement.transaction}`,
      );

      const headers = new Headers(response.headers);
      headers.set('x-payment-response', settleResponseHeader(settlement));
      if (settlement.transaction) {
        headers.set('x-payment-tx-hash', settlement.transaction);
      }
      headers.set('x-payment-source', String(source));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

