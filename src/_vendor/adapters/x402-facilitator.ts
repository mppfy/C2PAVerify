// VENDOR: C2PAVerify-specific module. Not yet in mppfy/platform core.
// Extract to @mppfy/platform-core after x402 feature is merged.

/**
 * x402FacilitatorClient — thin HTTP client for the x402 facilitator protocol.
 *
 * Facilitator spec: https://docs.x402.org/extensions/bazaar
 * Endpoints used:
 *   POST /verify   — check signed payment payload is valid + authorized
 *   POST /settle   — trigger actual on-chain settlement
 *
 * Public default: https://x402.org/facilitator — free, no API key, supports
 * Base mainnet + Base Sepolia. CDP facilitator (paid, API key) is opt-in via
 * X402_FACILITATOR_URL + createAuthHeaders if we ever need it.
 *
 * Implementation note: we delegate to `useFacilitator()` from the `x402` npm
 * package (v1.1.0) rather than hand-rolling. Benefits:
 * - Zod schemas for request/response come from the SDK (spec-aligned).
 * - Future x402Version bumps handled by upgrading the package, not us.
 * - Workers bundle impact measured ≈ 218 KB gzipped (acceptable).
 *
 * Resilience layer (added 2026-04-20 after infra-audit):
 * - Timeout (`timeoutMs`, default 5000) via Promise.race. SDK useFacilitator
 *   не выставляет AbortController, так что через race — единственный чистый
 *   способ из Workers.
 * - Fallback URL (`fallbackUrl`). Если primary падает/timeout — пробуем
 *   secondary один раз. PayAI facilitator (primary) периодически
 *   деградирует; x402.org/facilitator (free) = надёжный fallback без
 *   catalog auto-list, но verify/settle продолжают работать. Выбор «хорошо
 *   принимаем оплату, но не попадаем в PayAI Bazaar для этих запросов»
 *   предпочтительнее чем «отказываем агенту в оплате».
 * - Fail-closed: если оба facilitator'а недоступны — возвращаем
 *   `isValid=false` / `success=false`, чтобы caller сгенерировал 402 заново.
 */

import { useFacilitator } from 'x402/verify';
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  FacilitatorConfig,
} from 'x402/types';

export interface X402FacilitatorClient {
  readonly url: string;
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}

export interface CreateFacilitatorClientOptions {
  /** Facilitator URL — must be https://...-prefixed. */
  url: string;
  /**
   * Optional secondary facilitator — used when primary times out or throws.
   * Defaults to `https://x402.org/facilitator` (no-auth public fallback).
   */
  fallbackUrl?: string;
  /**
   * Per-call timeout in ms. Default 5000 (verify) / 20000 (settle — on-chain).
   * Keep `verify` tight: if facilitator is slow, agent's MPP retry finishes
   * faster than x402 and customer gets served via dual-protocol fallback.
   */
  timeoutMs?: number;
  /**
   * Optional auth headers provider. Only needed for CDP facilitator.
   * For public x402.org/facilitator, leave undefined.
   */
  createAuthHeaders?: FacilitatorConfig['createAuthHeaders'];
}

const DEFAULT_VERIFY_TIMEOUT_MS = 5000;
// Settlement is on-chain (Base ~2s block, but RPC occasionally slow) —
// шире, чтобы не зарезать успешные расчёты.
const DEFAULT_SETTLE_TIMEOUT_MS = 20000;
const DEFAULT_FALLBACK_URL = 'https://x402.org/facilitator';

function buildSdkClient(
  url: string,
  createAuthHeaders?: FacilitatorConfig['createAuthHeaders'],
): ReturnType<typeof useFacilitator> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(
      `[x402-facilitator] Invalid URL: ${url} — must start with http(s)://`,
    );
  }
  const config: FacilitatorConfig = {
    url: url as `${string}://${string}`,
    ...(createAuthHeaders ? { createAuthHeaders } : {}),
  };
  return useFacilitator(config);
}

/**
 * Run a promise against a timeout. Rejects with `TimeoutError` if exceeded.
 * Используем вместо AbortController потому что SDK не exposing signal.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} exceeded ${ms}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Create a facilitator client with timeout + single fallback. Safe to call
 * per-request — construction is cheap (no network I/O, just SDK object init).
 */
export function createFacilitatorClient(
  options: CreateFacilitatorClientOptions,
): X402FacilitatorClient {
  const primaryUrl = options.url;
  const fallbackUrl = options.fallbackUrl ?? DEFAULT_FALLBACK_URL;
  const useFallback = fallbackUrl && fallbackUrl !== primaryUrl;

  const primary = buildSdkClient(primaryUrl, options.createAuthHeaders);
  // Fallback всегда no-auth (public x402.org). Если потребуется auth на
  // fallback — добавить отдельный createAuthHeadersFallback option.
  const secondary = useFallback ? buildSdkClient(fallbackUrl) : null;

  const verifyTimeout = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const settleTimeout = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  async function tryVerify(
    client: ReturnType<typeof useFacilitator>,
    url: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return withTimeout(
      client.verify(payload, requirements),
      verifyTimeout,
      `[x402-facilitator ${url}] verify`,
    );
  }

  async function trySettle(
    client: ReturnType<typeof useFacilitator>,
    url: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return withTimeout(
      client.settle(payload, requirements),
      settleTimeout,
      `[x402-facilitator ${url}] settle`,
    );
  }

  return {
    url: primaryUrl,
    async verify(payload, requirements) {
      try {
        return await tryVerify(primary, primaryUrl, payload, requirements);
      } catch (err) {
        console.error(`[x402-facilitator] primary verify failed (${primaryUrl}):`, err);
        if (secondary) {
          try {
            const res = await tryVerify(secondary, fallbackUrl, payload, requirements);
            console.warn(
              `[x402-facilitator] verify succeeded on fallback (${fallbackUrl})`,
            );
            return res;
          } catch (fbErr) {
            console.error(
              `[x402-facilitator] fallback verify also failed (${fallbackUrl}):`,
              fbErr,
            );
          }
        }
        // Fail-closed: any facilitator error → treat as invalid payment.
        // Caller creates 402 challenge, agent retries.
        return {
          isValid: false,
          invalidReason: 'facilitator_unavailable',
          payer: undefined as never, // SDK typing requires this field on invalid
        } as unknown as VerifyResponse;
      }
    },
    async settle(payload, requirements) {
      try {
        return await trySettle(primary, primaryUrl, payload, requirements);
      } catch (err) {
        console.error(`[x402-facilitator] primary settle failed (${primaryUrl}):`, err);
        if (secondary) {
          try {
            const res = await trySettle(secondary, fallbackUrl, payload, requirements);
            console.warn(
              `[x402-facilitator] settle succeeded on fallback (${fallbackUrl})`,
            );
            return res;
          } catch (fbErr) {
            console.error(
              `[x402-facilitator] fallback settle also failed (${fallbackUrl}):`,
              fbErr,
            );
          }
        }
        return {
          success: false,
          errorReason: 'facilitator_unavailable',
          transaction: '' as `0x${string}`,
          network: requirements.network,
          payer: '' as `0x${string}`,
        } as unknown as SettleResponse;
      }
    },
  };
}

// ─── Facilitator Pool ───────────────────────────────────────────
/**
 * Multi-primary facilitator pool with sticky verify↔settle routing.
 *
 * **Why a pool:** CDP Bazaar (Coinbase discovery) and PayAI Bazaar each
 * expose *their own* discovery catalog populated only from payments that
 * pass through *their* facilitator. To be listed in both catalogs we must
 * actually send a fraction of real traffic through each primary. Round-
 * robin across `primaries` achieves this with zero extra state per
 * request.
 *
 * **Why sticky verify↔settle:** x402 facilitators stash per-payment state
 * between `/verify` (check signature/funds) and `/settle` (broadcast tx).
 * If we verify on CDP and then settle on PayAI, PayAI does not know about
 * this payment and rejects. Worse, in pathological races both could
 * charge. So: once `pickForVerify()` returns a `PickedFacilitator`, the
 * caller must do `verify()` and `settle()` on the *same* object.
 *
 * **Why settle has NO fallback:** verify failure → no money moved yet,
 * safe to retry on fallback. Settle failure → either the tx actually went
 * through and facilitator just can't report it (retry would double-spend),
 * or it genuinely failed (fallback won't help — payment state is on the
 * primary). Fail-closed: return `success:false`, caller omits receipt
 * header, agent retries entire flow.
 *
 * **Fallback semantics:** exactly one fallback facilitator (typically
 * x402.org/facilitator — no auth, no catalog, but functional). Used *only*
 * if the picked primary's verify() throws or times out. Selection is not
 * sticky for fallback — every primary shares the same fallback.
 */

export interface PoolPrimary {
  /** Pre-built client. Usually from `createFacilitatorClient(...)`. */
  readonly client: X402FacilitatorClient;
  /** Short label for logs/observability. e.g. "payai", "cdp", "x402-public". */
  readonly label: string;
}

export interface FacilitatorPoolOptions {
  /** Ordered list of primaries. Round-robin across successive pickForVerify(). */
  readonly primaries: readonly PoolPrimary[];
  /**
   * Optional single fallback facilitator. Used when a primary's verify()
   * throws. Settlement NEVER fails over — see module JSDoc.
   */
  readonly fallback?: PoolPrimary;
}

export interface PickedFacilitator {
  /** Label of the primary this picker is pinned to. */
  readonly label: string;
  /** Verify payment — tries primary once, then fallback if configured. */
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  /** Settle payment on pinned primary ONLY. No fallback. */
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}

export interface FacilitatorPool {
  /**
   * Pick a facilitator for a new payment. Round-robins across primaries
   * across successive calls. The returned object must be used for BOTH
   * verify() and settle() of the same payment.
   */
  pickForVerify(): PickedFacilitator;
}

export function createFacilitatorPool(
  options: FacilitatorPoolOptions,
): FacilitatorPool {
  if (options.primaries.length === 0) {
    throw new Error(
      '[x402-facilitator-pool] requires at least one primary facilitator',
    );
  }

  const primaries = [...options.primaries];
  const fallback = options.fallback;
  let cursor = 0;

  function pickForVerify(): PickedFacilitator {
    const primary = primaries[cursor % primaries.length]!;
    cursor = (cursor + 1) % primaries.length;

    return {
      label: primary.label,
      async verify(payload, requirements) {
        try {
          return await primary.client.verify(payload, requirements);
        } catch (err) {
          console.error(
            `[x402-pool] primary verify failed (${primary.label} ${primary.client.url}):`,
            err,
          );
          if (fallback) {
            try {
              const res = await fallback.client.verify(payload, requirements);
              console.warn(
                `[x402-pool] verify succeeded on fallback (${fallback.label} ${fallback.client.url})`,
              );
              return res;
            } catch (fbErr) {
              console.error(
                `[x402-pool] fallback verify also failed (${fallback.label} ${fallback.client.url}):`,
                fbErr,
              );
            }
          }
          return {
            isValid: false,
            invalidReason: 'facilitator_unavailable',
            payer: undefined as never,
          } as unknown as VerifyResponse;
        }
      },
      async settle(payload, requirements) {
        try {
          return await primary.client.settle(payload, requirements);
        } catch (err) {
          console.error(
            `[x402-pool] settle failed on pinned primary (${primary.label} ${primary.client.url}) — NOT falling back:`,
            err,
          );
          return {
            success: false,
            errorReason: 'facilitator_unavailable',
            transaction: '' as `0x${string}`,
            network: requirements.network,
            payer: '' as `0x${string}`,
          } as unknown as SettleResponse;
        }
      },
    };
  }

  return { pickForVerify };
}
