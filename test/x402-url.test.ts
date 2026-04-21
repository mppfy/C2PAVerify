/**
 * URL predicate tests — security-critical gating for CDP auth header
 * injection and plaintext-HTTP enforcement on facilitator endpoints.
 *
 * These tests lock in findings from the 2026-04-21 security review:
 *   "url.includes('api.cdp.coinbase.com')" is unsafe — a URL such as
 *   `https://evil.api.cdp.coinbase.com.attacker.com/...` would match and
 *   leak CDP API credentials. The fix is exact-hostname match.
 *
 * Regression-guard rule: if any of these tests is ever deleted or softened,
 * the security posture of the facilitator pool has regressed — block.
 */

import { describe, it, expect } from 'vitest';
import {
  CDP_FACILITATOR_HOSTS,
  isCdpFacilitatorUrl,
  parseFacilitatorUrl,
} from '../src/_vendor/adapters/x402-url';

describe('isCdpFacilitatorUrl', () => {
  describe('accepts legitimate CDP endpoints', () => {
    it('matches api.cdp.coinbase.com exactly', () => {
      expect(
        isCdpFacilitatorUrl('https://api.cdp.coinbase.com/platform/v2/x402'),
      ).toBe(true);
    });

    it('matches api.cdp.coinbase.com with trailing slash and no path', () => {
      expect(isCdpFacilitatorUrl('https://api.cdp.coinbase.com/')).toBe(true);
    });

    it('matches api.cdp.coinbase.com with query string', () => {
      expect(
        isCdpFacilitatorUrl(
          'https://api.cdp.coinbase.com/platform/v2/x402?foo=bar',
        ),
      ).toBe(true);
    });
  });

  describe('REJECTS lookalike hosts (credential exfiltration guards)', () => {
    it('rejects subdomain attack: evil.api.cdp.coinbase.com', () => {
      expect(
        isCdpFacilitatorUrl('https://evil.api.cdp.coinbase.com/x402'),
      ).toBe(false);
    });

    it('rejects suffix attack: api.cdp.coinbase.com.attacker.com', () => {
      // This is THE substring-match failure that motivated exact-host check.
      // If this ever returns true, CDP credentials leak to the attacker.
      expect(
        isCdpFacilitatorUrl(
          'https://api.cdp.coinbase.com.attacker.com/platform/v2/x402',
        ),
      ).toBe(false);
    });

    it('rejects hyphenated host: api-cdp-coinbase-com.evil.com', () => {
      expect(
        isCdpFacilitatorUrl('https://api-cdp-coinbase-com.evil.com/x402'),
      ).toBe(false);
    });

    it('rejects path containing api.cdp.coinbase.com as literal text', () => {
      // Would have tripped the old substring check.
      expect(
        isCdpFacilitatorUrl(
          'https://attacker.com/proxy?fwd=api.cdp.coinbase.com',
        ),
      ).toBe(false);
    });

    it('rejects regional-but-not-in-allowlist host', () => {
      // If CDP adds regional endpoints (e.g. eu-api.cdp.coinbase.com), they
      // must be explicitly added to CDP_FACILITATOR_HOSTS — silent
      // acceptance would widen the credential surface.
      expect(
        isCdpFacilitatorUrl('https://eu-api.cdp.coinbase.com/platform/v2/x402'),
      ).toBe(false);
    });
  });

  describe('rejects plaintext HTTP (no credentials over unencrypted transport)', () => {
    it('rejects http:// CDP URL', () => {
      expect(
        isCdpFacilitatorUrl('http://api.cdp.coinbase.com/platform/v2/x402'),
      ).toBe(false);
    });
  });

  describe('rejects malformed URLs without throwing', () => {
    it('returns false for not-a-url', () => {
      expect(isCdpFacilitatorUrl('not-a-url')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isCdpFacilitatorUrl('')).toBe(false);
    });
  });

  describe('allowlist shape', () => {
    it('exposes exactly the expected hosts', () => {
      // Snapshot the allowlist so any additions/removals are reviewed
      // deliberately as part of the security surface.
      expect([...CDP_FACILITATOR_HOSTS]).toEqual(['api.cdp.coinbase.com']);
    });
  });
});

describe('parseFacilitatorUrl', () => {
  it('returns parsed URL for valid https', () => {
    const parsed = parseFacilitatorUrl('https://facilitator.payai.network');
    expect(parsed.hostname).toBe('facilitator.payai.network');
    expect(parsed.protocol).toBe('https:');
  });

  it('throws on http:// URL with operator-facing message', () => {
    expect(() =>
      parseFacilitatorUrl('http://facilitator.payai.network'),
    ).toThrow(/must be https/);
  });

  it('throws on malformed URL', () => {
    expect(() => parseFacilitatorUrl('not-a-url')).toThrow(
      /invalid facilitator URL/,
    );
  });

  it('throws on ws:// URL (https-only — no other protocols)', () => {
    expect(() =>
      parseFacilitatorUrl('ws://facilitator.payai.network'),
    ).toThrow(/must be https/);
  });
});
