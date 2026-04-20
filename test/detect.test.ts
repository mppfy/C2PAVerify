/**
 * Unit tests for protocol detection (pure function).
 *
 * Verifies each precedence step in isolation and the fallthrough path when
 * higher-priority signals are malformed. Rollout-critical — a wrong default
 * here would silently flip every agent to the wrong protocol.
 */

import { describe, it, expect } from 'vitest';
import { detectProtocol } from '../src/_vendor/adapters/detect';

function req(headers: Record<string, string>): Request {
  return new Request('https://example.com/verify', { headers });
}

describe('detectProtocol', () => {
  const defaults = { defaultProtocol: 'mpp' as const };

  it('returns default when no headers are present', () => {
    expect(detectProtocol(req({}), defaults)).toEqual({
      protocol: 'mpp',
      reason: 'default',
    });
  });

  it('respects x402 default when configured', () => {
    expect(detectProtocol(req({}), { defaultProtocol: 'x402' })).toEqual({
      protocol: 'x402',
      reason: 'default',
    });
  });

  it('honors explicit x-payment-protocol: mpp override', () => {
    expect(
      detectProtocol(req({ 'x-payment-protocol': 'mpp' }), defaults),
    ).toEqual({ protocol: 'mpp', reason: 'explicit-header' });
  });

  it('honors explicit x-payment-protocol: x402 override', () => {
    expect(
      detectProtocol(req({ 'x-payment-protocol': 'x402' }), defaults),
    ).toEqual({ protocol: 'x402', reason: 'explicit-header' });
  });

  it('explicit header wins over Authorization: Payment', () => {
    // MPP wire signal present, but client explicitly asks for x402 challenge.
    expect(
      detectProtocol(
        req({
          'x-payment-protocol': 'x402',
          authorization: 'Payment abc123',
        }),
        defaults,
      ),
    ).toEqual({ protocol: 'x402', reason: 'explicit-header' });
  });

  it('unknown x-payment-protocol value falls through to next precedence', () => {
    // Malformed override must not throw, and must not force a wrong protocol.
    expect(
      detectProtocol(
        req({
          'x-payment-protocol': 'bitcoin',
          authorization: 'Payment abc123',
        }),
        defaults,
      ),
    ).toEqual({ protocol: 'mpp', reason: 'auth-payment' });
  });

  it('is case-insensitive on explicit header value', () => {
    expect(
      detectProtocol(req({ 'x-payment-protocol': 'X402' }), defaults),
    ).toEqual({ protocol: 'x402', reason: 'explicit-header' });
  });

  it('detects MPP via Authorization: Payment scheme', () => {
    expect(
      detectProtocol(
        req({ authorization: 'Payment eyJhbGciOi...' }),
        defaults,
      ),
    ).toEqual({ protocol: 'mpp', reason: 'auth-payment' });
  });

  it('is case-insensitive on Authorization scheme token', () => {
    expect(
      detectProtocol(req({ authorization: 'payment xyz' }), defaults),
    ).toEqual({ protocol: 'mpp', reason: 'auth-payment' });
  });

  it('does NOT mistake Authorization: Bearer for MPP', () => {
    expect(
      detectProtocol(
        req({ authorization: 'Bearer abc123' }),
        { defaultProtocol: 'x402' },
      ),
    ).toEqual({ protocol: 'x402', reason: 'default' });
  });

  it('detects x402 via X-PAYMENT header', () => {
    expect(
      detectProtocol(req({ 'x-payment': 'base64payload' }), defaults),
    ).toEqual({ protocol: 'x402', reason: 'x-payment' });
  });

  it('Authorization: Payment wins over X-PAYMENT when both present', () => {
    // Shouldn't happen in the wild, but precedence matters — MPP precedes x402
    // so existing MPP clients are never reinterpreted as x402.
    expect(
      detectProtocol(
        req({
          authorization: 'Payment abc',
          'x-payment': 'base64',
        }),
        defaults,
      ),
    ).toEqual({ protocol: 'mpp', reason: 'auth-payment' });
  });

  it('detects via Accept: application/vnd.x402+json', () => {
    expect(
      detectProtocol(
        req({ accept: 'application/vnd.x402+json' }),
        defaults,
      ),
    ).toEqual({ protocol: 'x402', reason: 'accept-vendor' });
  });

  it('detects via Accept: application/vnd.mpp+json', () => {
    expect(
      detectProtocol(
        req({ accept: 'application/vnd.mpp+json' }),
        { defaultProtocol: 'x402' },
      ),
    ).toEqual({ protocol: 'mpp', reason: 'accept-vendor' });
  });

  it('ignores unrelated Accept values', () => {
    expect(
      detectProtocol(
        req({ accept: 'application/json, text/plain' }),
        defaults,
      ),
    ).toEqual({ protocol: 'mpp', reason: 'default' });
  });

  it('wire signals always win over Accept hint', () => {
    // Accept is a soft hint; if the client actually sent a wire-level signal,
    // we use that.
    expect(
      detectProtocol(
        req({
          accept: 'application/vnd.mpp+json',
          'x-payment': 'base64',
        }),
        defaults,
      ),
    ).toEqual({ protocol: 'x402', reason: 'x-payment' });
  });
});
