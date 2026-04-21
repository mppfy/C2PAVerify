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

  it('GET /openapi.json returns OpenAPI 3.1 spec', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/openapi.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('C2PAVerify');
    expect(body.paths['/verify']).toBeDefined();
    expect(body.paths['/.well-known/mpp-services']).toBeDefined();
  });

  it('GET /.well-known/mpp-services returns identical payload to /openapi.json', async () => {
    const [wellKnownRes, openapiRes] = await Promise.all([
      SELF.fetch('https://c2pa-staging.mppfy.com/.well-known/mpp-services'),
      SELF.fetch('https://c2pa-staging.mppfy.com/openapi.json'),
    ]);
    expect(wellKnownRes.status).toBe(200);
    expect(openapiRes.status).toBe(200);
    const wellKnownBody = await wellKnownRes.json();
    const openapiBody = await openapiRes.json();
    // Both endpoints must return byte-identical JSON so aggregators can cache
    // either path without hashing mismatch.
    expect(wellKnownBody).toEqual(openapiBody);
  });
});
