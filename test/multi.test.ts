/**
 * Unit tests for createMultiProtocolAdapter dispatcher.
 *
 * Uses stub adapters so we test dispatch logic in isolation — no real
 * MPP or x402 SDK calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMultiProtocolAdapter } from '../src/_vendor/adapters/multi';
import type {
  PaymentAdapter,
  PaymentRequirement,
  PaymentVerification,
} from '../src/_vendor/adapters/types';

function makeStub(name: 'mpp' | 'x402'): PaymentAdapter {
  return {
    name,
    detects: vi.fn().mockReturnValue(true),
    verify: vi.fn().mockResolvedValue({
      verified: true,
      protocol: name,
      amount: '0.01',
    } satisfies PaymentVerification),
    create402: vi.fn().mockImplementation(
      () => new Response(`from-${name}`, { status: 402 }),
    ),
    attachReceipt: vi.fn().mockImplementation(
      (resp: Response) => new Response(resp.body, {
        status: resp.status,
        headers: { 'x-routed-via': name },
      }),
    ),
    settle: vi.fn().mockImplementation(
      async (_req: Request, resp: Response) =>
        new Response(resp.body, {
          status: resp.status,
          headers: { 'x-settled-by': name },
        }),
    ),
  };
}

const requirement: PaymentRequirement = {
  amount: '0.01',
  currency: 'USDC',
  recipient: '0x1234567890123456789012345678901234567890',
  network: 'base',
  serviceId: 'c2pa-verify',
};

describe('createMultiProtocolAdapter', () => {
  it('routes verify() to MPP when Authorization: Payment present', async () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const request = new Request('https://example.com/verify', {
      headers: { authorization: 'Payment abc' },
    });
    const result = await adapter.verify(request, requirement);

    expect(mpp.verify).toHaveBeenCalledOnce();
    expect(x402.verify).not.toHaveBeenCalled();
    expect(result?.metadata?.detectionReason).toBe('auth-payment');
    expect(result?.metadata?.detectedProtocol).toBe('mpp');
  });

  it('routes verify() to x402 when X-PAYMENT present', async () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const request = new Request('https://example.com/verify', {
      headers: { 'x-payment': 'base64' },
    });
    await adapter.verify(request, requirement);

    expect(x402.verify).toHaveBeenCalledOnce();
    expect(mpp.verify).not.toHaveBeenCalled();
  });

  it('routes create402() to the same adapter detection picked', () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const request = new Request('https://example.com/verify', {
      headers: { 'x-payment-protocol': 'x402' },
    });
    const response = adapter.create402(requirement, request);

    expect(x402.create402).toHaveBeenCalledOnce();
    expect(mpp.create402).not.toHaveBeenCalled();
    expect(response.status).toBe(402);
  });

  it('caches detection result across verify → create402 calls', async () => {
    // This guards the "one detection per request" guarantee.
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    // Stub verify to return null (simulating unpaid request).
    (mpp.verify as any).mockResolvedValueOnce(null);

    const request = new Request('https://example.com/verify', {
      headers: { authorization: 'Payment abc' },
    });

    const verified = await adapter.verify(request, requirement);
    expect(verified).toBeNull();

    // create402 should use the same detection result — MPP.
    adapter.create402(requirement, request);
    expect(mpp.create402).toHaveBeenCalledOnce();
    expect(x402.create402).not.toHaveBeenCalled();
  });

  it('attachReceipt routes by verification.protocol, not request', () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const verified: PaymentVerification = {
      verified: true,
      protocol: 'x402',
      amount: '0.01',
    };
    const resp = adapter.attachReceipt(new Response('ok'), verified);

    expect(x402.attachReceipt).toHaveBeenCalledOnce();
    expect(mpp.attachReceipt).not.toHaveBeenCalled();
    expect(resp.headers.get('x-routed-via')).toBe('x402');
  });

  it('settle routes to verification.protocol adapter', async () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const request = new Request('https://example.com/verify');
    const verified: PaymentVerification = {
      verified: true,
      protocol: 'x402',
      amount: '0.01',
    };
    const out = await adapter.settle!(request, new Response('ok'), verified);

    expect(x402.settle).toHaveBeenCalledOnce();
    expect(mpp.settle).not.toHaveBeenCalled();
    expect(out.headers.get('x-settled-by')).toBe('x402');
  });

  it('settle is a no-op when child adapter does not implement it', async () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    // Simulate MPP adapter WITHOUT settle() (optional field).
    delete (mpp as { settle?: unknown }).settle;
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const original = new Response('ok');
    const out = await adapter.settle!(new Request('https://example.com/verify'), original, {
      verified: true,
      protocol: 'mpp',
      amount: '0.01',
    });
    expect(out).toBe(original);
    expect(x402.settle).not.toHaveBeenCalled();
  });

  it('attachReceipt gracefully handles unknown protocol', () => {
    const mpp = makeStub('mpp');
    const x402 = makeStub('x402');
    const adapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: { defaultProtocol: 'mpp' },
    });

    const original = new Response('ok');
    const returned = adapter.attachReceipt(original, {
      verified: true,
      protocol: 'unknown-future-proto',
      amount: '0.01',
    });

    // Neither adapter called; response returned unchanged.
    expect(mpp.attachReceipt).not.toHaveBeenCalled();
    expect(x402.attachReceipt).not.toHaveBeenCalled();
    expect(returned).toBe(original);
  });
});
