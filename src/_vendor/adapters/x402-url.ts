// VENDOR: C2PAVerify-specific module. Not yet in mppfy/platform core.
// Extract to @mppfy/platform-core together with x402 adapter after feature
// stabilizes.

/**
 * URL predicates for facilitator routing. Extracted into a standalone
 * module so the security-critical CDP detection + HTTPS enforcement can
 * be unit-tested without touching the pool construction path.
 *
 * Rationale for extraction (from security review on 2026-04-21):
 *   Original inline check used `url.includes('api.cdp.coinbase.com')` —
 *   a substring match that would leak CDP credentials to an attacker-
 *   controlled URL like `https://evil.api.cdp.coinbase.com.attacker.com`.
 *   Fix: exact-hostname match after URL parsing, plus https-only guard.
 */

/**
 * Exact hostnames we recognize as CDP facilitator endpoints. Only URLs
 * whose parsed hostname is in this set will receive `createCdpAuthHeaders`
 * credential injection. Add regional hosts here as CDP introduces them
 * (e.g. 'eu-api.cdp.coinbase.com').
 */
export const CDP_FACILITATOR_HOSTS: ReadonlySet<string> = new Set([
  'api.cdp.coinbase.com',
]);

/**
 * True iff `url` parses as a valid URL and its hostname is an exact CDP
 * facilitator host. Returns false for malformed URLs, non-https URLs, or
 * lookalike hosts. Use this to gate CDP auth header injection.
 */
export function isCdpFacilitatorUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return CDP_FACILITATOR_HOSTS.has(parsed.hostname);
}

/**
 * Parse a facilitator URL and enforce https://. Throws with a clear
 * operator-facing message on malformed or plaintext input. Callers
 * should run this at pool-construction time (startup) so misconfigured
 * env vars fail loudly instead of silently forwarding signed payloads
 * over http://.
 */
export function parseFacilitatorUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[x402] invalid facilitator URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `[x402] facilitator URL must be https:// (got "${parsed.protocol}//${parsed.host}")`,
    );
  }
  return parsed;
}
