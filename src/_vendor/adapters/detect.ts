// VENDOR: C2PAVerify-specific module. Not yet in mppfy/platform core.
// Extract to @mppfy/platform-core after x402 feature is merged.

/**
 * Protocol detection — pure function that inspects request headers and
 * returns which payment protocol the client is (or wants to be) using.
 *
 * Called once per request in the /verify handler. Result is consumed by
 * `createMultiProtocolAdapter()` to dispatch verify/create402/attachReceipt
 * to the correct protocol-specific adapter.
 *
 * Precedence (first match wins):
 *   1. `x-payment-protocol: mpp | x402`     — explicit client override
 *   2. `Authorization: Payment <...>`        — MPP wire signal
 *   3. `X-PAYMENT: <base64>`                 — x402 wire signal
 *   4. `Accept: application/vnd.{mpp,x402}+json`
 *   5. Configured default (shadow-rollout strategy)
 *
 * Design notes:
 * - Pure function: no I/O, no side effects. Trivial to unit-test.
 * - Zod validates the one header we actually branch on (`x-payment-protocol`),
 *   so a malformed override falls through to the next precedence step rather
 *   than throwing. All other headers are only checked for presence/shape —
 *   real validation happens inside the adapter's `verify()`.
 * - Returns a structured result (`protocol` + `reason`) for observability.
 *   The reason tag flows into Analytics Engine so we can see the protocol mix
 *   and detection path in production traffic.
 */

import { z } from 'zod';

export type DetectedProtocol = 'mpp' | 'x402';

/** Why this protocol was chosen — logged for rollout analysis. */
export type DetectionReason =
  | 'explicit-header'     // x-payment-protocol override
  | 'auth-payment'        // Authorization: Payment <...>
  | 'x-payment'           // X-PAYMENT: <...>
  | 'accept-vendor'       // Accept: application/vnd.X+json
  | 'default';            // fell through to configured default

export interface DetectionResult {
  readonly protocol: DetectedProtocol;
  readonly reason: DetectionReason;
}

export interface DetectProtocolOptions {
  /**
   * Protocol to use when no wire signal is present.
   * During shadow rollout this is 'mpp' — we don't surprise existing clients
   * that never sent any payment headers. Flip to 'x402' after 7 days of clean
   * prod traffic per the rollout plan.
   */
  readonly defaultProtocol: DetectedProtocol;
}

// Zod schema for the explicit override header. Kept narrow on purpose —
// any other string value falls through to the next precedence step.
const explicitProtocolSchema = z.enum(['mpp', 'x402']);

// Vendor media type pattern: application/vnd.<protocol>+json
const ACCEPT_VENDOR_RE = /application\/vnd\.(mpp|x402)(?:\+json)?/i;

/**
 * Inspect request headers and decide which payment protocol applies.
 *
 * Never throws. Always returns a concrete protocol — falls back to
 * `options.defaultProtocol` when no signal is present.
 */
export function detectProtocol(
  request: Request,
  options: DetectProtocolOptions,
): DetectionResult {
  const headers = request.headers;

  // 1. Explicit override — highest priority.
  const explicit = headers.get('x-payment-protocol');
  if (explicit !== null) {
    const parsed = explicitProtocolSchema.safeParse(explicit.toLowerCase().trim());
    if (parsed.success) {
      return { protocol: parsed.data, reason: 'explicit-header' };
    }
    // Unknown value — log once and fall through. Don't 400 the client,
    // some clients send vendor-specific values we don't care about.
    console.warn('[detect] unknown x-payment-protocol value, ignoring:', explicit);
  }

  // 2. MPP wire signal: Authorization: Payment <credential>
  const auth = headers.get('authorization');
  if (auth !== null && /^Payment\s+/i.test(auth)) {
    return { protocol: 'mpp', reason: 'auth-payment' };
  }

  // 3. x402 wire signal: X-PAYMENT: <base64 payload>
  if (headers.get('x-payment') !== null) {
    return { protocol: 'x402', reason: 'x-payment' };
  }

  // 4. Accept vendor media type — soft signal used by discovery-oriented
  //    clients that haven't paid yet but want a protocol-specific 402.
  const accept = headers.get('accept');
  if (accept !== null) {
    const match = ACCEPT_VENDOR_RE.exec(accept);
    if (match) {
      const hinted = match[1].toLowerCase() as DetectedProtocol;
      return { protocol: hinted, reason: 'accept-vendor' };
    }
  }

  // 5. Default — no signal; use configured fallback.
  return { protocol: options.defaultProtocol, reason: 'default' };
}
