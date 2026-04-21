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

describe('Agent-readiness discovery endpoints', () => {
  it('GET /robots.txt returns AI bot rules + sitemap', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await res.text();
    // Contract: named AI crawlers explicitly allowed, sitemap linked,
    // content-signals present for Cloudflare aggregators.
    expect(text).toContain('User-agent: ClaudeBot');
    expect(text).toContain('User-agent: GPTBot');
    expect(text).toContain('Sitemap: https://c2pa-staging.mppfy.com/sitemap.xml');
    // Singular "Content-Signal:" per Cloudflare spec — scanner rejects plural.
    expect(text).toMatch(/^Content-Signal:/m);
  });

  it('GET /sitemap.xml lists primary discovery URLs', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/xml/);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://c2pa-staging.mppfy.com</loc>');
    expect(xml).toContain('<loc>https://c2pa-staging.mppfy.com/openapi.json</loc>');
    expect(xml).toContain('<loc>https://c2pa-staging.mppfy.com/.well-known/mcp/server-card.json</loc>');
  });

  it('GET /.well-known/api-catalog returns RFC 9727 linkset', async () => {
    const res = await SELF.fetch(
      'https://c2pa-staging.mppfy.com/.well-known/api-catalog',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/linkset+json');
    const body = (await res.json()) as {
      linkset: Array<{
        anchor: string;
        'service-desc': Array<{ href: string }>;
      }>;
    };
    expect(body.linkset).toHaveLength(1);
    expect(body.linkset[0]!.anchor).toBe('https://c2pa-staging.mppfy.com');
    // First service-desc link must point at the canonical OpenAPI.
    expect(body.linkset[0]!['service-desc'][0]!.href).toBe(
      'https://c2pa-staging.mppfy.com/openapi.json',
    );
  });

  it('GET /.well-known/mcp/server-card.json exposes verify_c2pa_manifest tool', async () => {
    const res = await SELF.fetch(
      'https://c2pa-staging.mppfy.com/.well-known/mcp/server-card.json',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      transport: { type: string; command: string };
      tools: Array<{ name: string; inputSchema: { required: string[] } }>;
      authentication: { type: string; protocols: string[] };
    };
    expect(body.name).toBe('c2pa-verify');
    expect(body.transport.type).toBe('stdio');
    expect(body.transport.command).toBe('npx');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]!.name).toBe('verify_c2pa_manifest');
    expect(body.tools[0]!.inputSchema.required).toEqual(['url']);
    expect(body.authentication.protocols).toContain('x402');
  });

  it('GET / emits Link header with service-desc discovery hints', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/');
    expect(res.status).toBe(200);
    const link = res.headers.get('link');
    expect(link).toBeTruthy();
    // Must reference the canonical OpenAPI spec and MCP server card so
    // crawlers get discovery links from a single HEAD /.
    expect(link).toContain('</openapi.json>');
    expect(link).toContain('rel="service-desc"');
    expect(link).toContain('</.well-known/mcp/server-card.json>');
    expect(link).toContain('rel="mcp-server"');
  });

  it('GET / with Accept: text/markdown returns llms.txt as markdown', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/', {
      headers: { accept: 'text/markdown' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const md = await res.text();
    // Must be the same llms.txt body (single source of truth).
    expect(md).toContain('# C2PAVerify');
    expect(md).toContain('POST /verify');
  });
});
