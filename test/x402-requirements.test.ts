/**
 * Unit tests for buildX402Requirements (pure helper).
 *
 * Shape/units must match x402 PaymentRequirements schema from x402@1.1.0.
 * A drift here produces 402 challenges the facilitator silently rejects.
 */

import { describe, it, expect } from 'vitest';
import { buildX402Requirements } from '../src/_vendor/adapters/x402';

const base = {
  recipientAddress: '0x1234567890123456789012345678901234567890',
  network: 'base-sepolia' as const,
  assetAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  resourceUrl: 'https://example.com/verify',
  description: 'Service: c2pa-verify',
};

describe('buildX402Requirements', () => {
  it('converts "0.01" USD → "10000" atomic units (USDC 6 decimals)', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.maxAmountRequired).toBe('10000');
  });

  it('converts "1" USD → "1000000" atomic units', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '1', ...base });
    expect(r.maxAmountRequired).toBe('1000000');
  });

  it('converts "0.000001" USD → "1" (smallest USDC unit)', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.000001', ...base });
    expect(r.maxAmountRequired).toBe('1');
  });

  it('sets scheme="exact" and propagates network', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.scheme).toBe('exact');
    expect(r.network).toBe('base-sepolia');
  });

  it('includes USDC EIP-712 extra metadata', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.extra).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('defaults mimeType to application/json', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.mimeType).toBe('application/json');
  });

  it('defaults maxTimeoutSeconds to 300', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.maxTimeoutSeconds).toBe(300);
  });

  it('honors explicit mimeType override', () => {
    const r = buildX402Requirements({
      amountDecimalUsd: '0.01',
      ...base,
      mimeType: 'image/jpeg',
    });
    expect(r.mimeType).toBe('image/jpeg');
  });

  it('sets payTo, asset, resource correctly', () => {
    const r = buildX402Requirements({ amountDecimalUsd: '0.01', ...base });
    expect(r.payTo).toBe(base.recipientAddress);
    expect(r.asset).toBe(base.assetAddress);
    expect(r.resource).toBe(base.resourceUrl);
  });
});
