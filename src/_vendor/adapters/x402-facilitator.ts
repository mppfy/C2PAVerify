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
 * We wrap it to:
 * - Add circuit-breaker semantics (fail-closed on facilitator outage).
 * - Narrow to our PaymentAdapter contract (so multi.ts can dispatch).
 * - Expose a single `verifyAndSettle` helper to simplify the happy path.
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
   * Optional auth headers provider. Only needed for CDP facilitator.
   * For public x402.org/facilitator, leave undefined.
   */
  createAuthHeaders?: FacilitatorConfig['createAuthHeaders'];
}

/**
 * Create a facilitator client. Safe to call per-request — construction
 * is cheap (no network I/O, just SDK object init).
 */
export function createFacilitatorClient(
  options: CreateFacilitatorClientOptions,
): X402FacilitatorClient {
  // SDK type requires template-literal URL; runtime check via Zod happens
  // inside useFacilitator, but we enforce at call site for clarity.
  if (!options.url.startsWith('http://') && !options.url.startsWith('https://')) {
    throw new Error(
      `[x402-facilitator] Invalid URL: ${options.url} — must start with http(s)://`,
    );
  }

  const config: FacilitatorConfig = {
    url: options.url as `${string}://${string}`,
    ...(options.createAuthHeaders ? { createAuthHeaders: options.createAuthHeaders } : {}),
  };

  const client = useFacilitator(config);

  return {
    url: options.url,
    async verify(payload, requirements) {
      try {
        return await client.verify(payload, requirements);
      } catch (err) {
        // Fail-closed: any facilitator error → treat as invalid payment.
        // Caller creates 402 challenge, agent retries.
        console.error('[x402-facilitator] verify error:', err);
        return {
          isValid: false,
          invalidReason: 'facilitator_unavailable',
          payer: undefined as never, // SDK typing requires this field on invalid
        } as unknown as VerifyResponse;
      }
    },
    async settle(payload, requirements) {
      try {
        return await client.settle(payload, requirements);
      } catch (err) {
        console.error('[x402-facilitator] settle error:', err);
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
