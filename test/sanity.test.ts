/**
 * Sanity check: vitest-pool-workers infra работает.
 * Worker отвечает на /health — не включает C2PA логику, только framework.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('Worker framework sanity', () => {
  it('GET /health returns 200 with expected body', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('c2pa-verify');
  });

  it('GET / returns service metadata', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      service: string;
      price: { amount: string; currency: string };
    };
    expect(body.service).toBe('c2pa-verify');
    expect(body.price.currency).toBe('USDC');
  });

  it('GET /llms.txt returns plain text spec', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await res.text();
    expect(text).toContain('C2PAVerify');
    expect(text).toContain('POST /verify');
  });
});
