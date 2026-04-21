/**
 * Tests for createFacilitatorPool — multi-facilitator routing with sticky
 * verify↔settle pinning.
 *
 * Contract:
 * - `pickForVerify()` round-robins across primaries.
 * - Returned `PickedFacilitator.verify` has single-fallback (tries primary
 *   once, then the pool's fallback facilitator if present). On both failing,
 *   returns `{ isValid: false, invalidReason: 'facilitator_unavailable' }`.
 * - Returned `PickedFacilitator.settle` MUST NOT use fallback — settlement
 *   state lives on the specific facilitator that verified. Using another
 *   facilitator for settle would double-spend or strand the payment.
 *
 * Tests use stub `X402FacilitatorClient` instances — no HTTP, no x402 SDK.
 * Real SDK wiring (URL + auth headers → client) is covered by existing
 * x402-requirements.test.ts + integration smoke.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createFacilitatorPool,
  type X402FacilitatorClient,
} from '../src/_vendor/adapters/x402-facilitator';
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from 'x402/types';

// Minimal payload/requirements shapes — type structure only; pool does not
// inspect them, it delegates to the picked client.
const payload = { x402Version: 1 } as unknown as PaymentPayload;
const requirements = {
  scheme: 'exact',
  network: 'base-sepolia',
  maxAmountRequired: '10000',
  resource: 'https://example.com/verify',
  description: 'test',
  mimeType: 'application/json',
  payTo: '0x0',
  maxTimeoutSeconds: 300,
  asset: '0x0',
  extra: { name: 'USD Coin', version: '2' },
} as unknown as PaymentRequirements;

const okVerify = (label: string): VerifyResponse =>
  ({ isValid: true, payer: `0xp${label}` as `0x${string}` }) as VerifyResponse;

const okSettle = (label: string): SettleResponse =>
  ({
    success: true,
    transaction: `0xtx${label}` as `0x${string}`,
    network: 'base',
    payer: `0xp${label}` as `0x${string}`,
  }) as SettleResponse;

function makeStubClient(label: string): X402FacilitatorClient {
  return {
    url: `https://${label}.example`,
    verify: vi.fn().mockResolvedValue(okVerify(label)),
    settle: vi.fn().mockResolvedValue(okSettle(label)),
  };
}

describe('createFacilitatorPool', () => {
  describe('primary round-robin', () => {
    it('rotates across primaries on successive pickForVerify() calls', async () => {
      const a = makeStubClient('a');
      const b = makeStubClient('b');
      const c = makeStubClient('c');
      const pool = createFacilitatorPool({
        primaries: [
          { client: a, label: 'a' },
          { client: b, label: 'b' },
          { client: c, label: 'c' },
        ],
      });

      const p1 = pool.pickForVerify();
      const p2 = pool.pickForVerify();
      const p3 = pool.pickForVerify();
      const p4 = pool.pickForVerify();

      expect(p1.label).toBe('a');
      expect(p2.label).toBe('b');
      expect(p3.label).toBe('c');
      expect(p4.label).toBe('a'); // wraps
    });

    it('single-primary pool always returns that primary', () => {
      const a = makeStubClient('a');
      const pool = createFacilitatorPool({
        primaries: [{ client: a, label: 'only' }],
      });
      expect(pool.pickForVerify().label).toBe('only');
      expect(pool.pickForVerify().label).toBe('only');
    });
  });

  describe('sticky verify ↔ settle', () => {
    it('routes verify and settle to the SAME primary client', async () => {
      const a = makeStubClient('a');
      const b = makeStubClient('b');
      const pool = createFacilitatorPool({
        primaries: [
          { client: a, label: 'a' },
          { client: b, label: 'b' },
        ],
      });

      // First call → primary a.
      const picked = pool.pickForVerify();
      expect(picked.label).toBe('a');

      await picked.verify(payload, requirements);
      await picked.settle(payload, requirements);

      expect(a.verify).toHaveBeenCalledOnce();
      expect(a.settle).toHaveBeenCalledOnce();
      expect(b.verify).not.toHaveBeenCalled();
      expect(b.settle).not.toHaveBeenCalled();
    });

    it('second pickForVerify() returns DIFFERENT client, settle stays pinned', async () => {
      const a = makeStubClient('a');
      const b = makeStubClient('b');
      const pool = createFacilitatorPool({
        primaries: [
          { client: a, label: 'a' },
          { client: b, label: 'b' },
        ],
      });

      const first = pool.pickForVerify(); // a
      const second = pool.pickForVerify(); // b

      await first.settle(payload, requirements);
      await second.settle(payload, requirements);

      expect(a.settle).toHaveBeenCalledOnce();
      expect(b.settle).toHaveBeenCalledOnce();
    });
  });

  describe('verify fallback chain', () => {
    it('uses fallback facilitator when primary throws', async () => {
      const a = makeStubClient('a');
      (a.verify as any).mockRejectedValue(new Error('primary down'));
      const fb = makeStubClient('fb');

      const pool = createFacilitatorPool({
        primaries: [{ client: a, label: 'a' }],
        fallback: { client: fb, label: 'fb' },
      });

      const picked = pool.pickForVerify();
      const result = await picked.verify(payload, requirements);

      expect(a.verify).toHaveBeenCalledOnce();
      expect(fb.verify).toHaveBeenCalledOnce();
      expect(result.isValid).toBe(true);
    });

    it('returns isValid:false when primary and fallback both fail', async () => {
      const a = makeStubClient('a');
      (a.verify as any).mockRejectedValue(new Error('primary down'));
      const fb = makeStubClient('fb');
      (fb.verify as any).mockRejectedValue(new Error('fallback down'));

      const pool = createFacilitatorPool({
        primaries: [{ client: a, label: 'a' }],
        fallback: { client: fb, label: 'fb' },
      });

      const picked = pool.pickForVerify();
      const result = await picked.verify(payload, requirements);

      expect(result.isValid).toBe(false);
      expect((result as any).invalidReason).toBe('facilitator_unavailable');
    });

    it('returns isValid:false when primary fails and no fallback configured', async () => {
      const a = makeStubClient('a');
      (a.verify as any).mockRejectedValue(new Error('primary down'));

      const pool = createFacilitatorPool({
        primaries: [{ client: a, label: 'a' }],
      });

      const picked = pool.pickForVerify();
      const result = await picked.verify(payload, requirements);

      expect(result.isValid).toBe(false);
    });

    it('tries next primary in round-robin before falling back to fallback', async () => {
      // Design decision: within a single pickForVerify() we pin ONE primary.
      // "Round-robin" means successive picks rotate; it does NOT mean a
      // single verify() cycles through all primaries. That would double-
      // charge fees and break sticky settle semantics.
      //
      // This test locks in: primary.verify() fails → go straight to
      // fallback, NOT to the next primary.
      const a = makeStubClient('a');
      (a.verify as any).mockRejectedValue(new Error('a down'));
      const b = makeStubClient('b');
      const fb = makeStubClient('fb');

      const pool = createFacilitatorPool({
        primaries: [
          { client: a, label: 'a' },
          { client: b, label: 'b' },
        ],
        fallback: { client: fb, label: 'fb' },
      });

      const picked = pool.pickForVerify(); // pins a
      await picked.verify(payload, requirements);

      expect(a.verify).toHaveBeenCalledOnce();
      expect(b.verify).not.toHaveBeenCalled();
      expect(fb.verify).toHaveBeenCalledOnce();
    });
  });

  describe('settle has NO fallback', () => {
    it('returns success:false when pinned facilitator settle() fails — does NOT try fallback', async () => {
      const a = makeStubClient('a');
      (a.settle as any).mockRejectedValue(new Error('primary settle down'));
      const fb = makeStubClient('fb');

      const pool = createFacilitatorPool({
        primaries: [{ client: a, label: 'a' }],
        fallback: { client: fb, label: 'fb' },
      });

      const picked = pool.pickForVerify();
      const result = await picked.settle(payload, requirements);

      expect(a.settle).toHaveBeenCalledOnce();
      expect(fb.settle).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect((result as any).errorReason).toBe('facilitator_unavailable');
    });
  });

  describe('empty pool rejection', () => {
    it('throws at construction if no primaries provided', () => {
      expect(() =>
        createFacilitatorPool({ primaries: [] }),
      ).toThrow(/at least one primary/i);
    });
  });
});
