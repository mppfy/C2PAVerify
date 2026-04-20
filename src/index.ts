/**
 * C2PAVerify — Cloudflare Worker entry point.
 *
 * Single-service MPPFY deployment. Routes:
 *   GET  /               — service metadata (free)
 *   GET  /llms.txt       — agent-friendly spec (free)
 *   GET  /health         — health check (free)
 *   POST /verify         — C2PA verification (paid, 402 if unpaid)
 */

import { Hono } from 'hono';
import type { ServiceEnv } from './_vendor/core/types';
import { createMPPAdapter } from './_vendor/adapters/mpp';
import { noneAdapter } from './_vendor/adapters/none';
import type { PaymentAdapter, PaymentRequirement } from './_vendor/adapters/types';
import { wrapHandler } from './_vendor/core/observability';
import { c2paVerify } from './service';

const app = new Hono<{ Bindings: ServiceEnv }>();

// ── Adapter: lazy singleton ─────────────────────────────────
let cachedAdapter: PaymentAdapter | null = null;

function getAdapter(env: ServiceEnv): PaymentAdapter {
  if (cachedAdapter) return cachedAdapter;

  const mode = env.PAYMENT_MODE;
  if (mode === 'dev') {
    cachedAdapter = noneAdapter;
  } else if (mode === 'mpp') {
    cachedAdapter = createMPPAdapter({
      recipientAddress: env.MPP_RECIPIENT_ADDRESS,
      secretKey: env.MPP_SECRET_KEY,
      testnet: env.ENVIRONMENT !== 'production',
    });
  } else {
    throw new Error(`Unknown PAYMENT_MODE: ${mode}`);
  }
  return cachedAdapter;
}

// ── Free endpoints ──────────────────────────────────────────
app.get('/', c => {
  return c.json({
    service: c2paVerify.id,
    name: c2paVerify.name,
    description: c2paVerify.description,
    categories: c2paVerify.categories,
    price: c2paVerify.price,
    status: c2paVerify.status,
    endpoints: {
      metadata: 'GET /',
      spec: 'GET /llms.txt',
      openapi: 'GET /openapi.json',
      health: 'GET /health',
      verify: 'POST /verify',
    },
    mpp_protocol: 'https://mpp.dev',
    docs: 'https://github.com/mppfy/C2PAVerify',
  });
});

app.get('/llms.txt', c => {
  const body = `# ${c2paVerify.name}

${c2paVerify.description}

## Endpoint
POST /verify

## Request
Body: { "url": "https://..." } OR multipart file upload
Auth: Authorization: Payment <mpp-credential>

## Price
${c2paVerify.price.amount} ${c2paVerify.price.currency} per call

## Protocol
MPP (Machine Payments Protocol) on Tempo chain
See https://mpp.dev for SDK and spec
OpenAPI discovery: GET /openapi.json

## Categories
${c2paVerify.categories.join(', ')}

## Status
${c2paVerify.status}

## Source
https://github.com/mppfy/C2PAVerify
`;
  return c.text(body, 200, { 'content-type': 'text/plain; charset=utf-8' });
});

app.get('/health', c => {
  return c.json({ status: 'ok', service: c2paVerify.id, env: c.env.ENVIRONMENT });
});

/**
 * OpenAPI 3.1 discovery document per MPP spec.
 * See https://mpp.dev/advanced/discovery — clients aggregate via /openapi.json
 * to learn payment requirements before issuing requests. Runtime 402 challenge
 * remains the authoritative source; this document is informational only.
 *
 * Currency is chain-dependent:
 *   - production (Tempo mainnet, chainId 4217): bridged USDC 0x20C0...E8b50
 *   - staging/dev (Tempo testnet, chainId 42431): pathUSD 0x20c0...0000
 * Amount in base units (6 decimals для TIP-20): "0.01" USDC = "10000".
 */
app.get('/openapi.json', c => {
  const isProd = c.env.ENVIRONMENT === 'production';
  const currency = isProd
    ? '0x20C000000000000000000000b9537d11c60E8b50' // mainnet bridged USDC
    : '0x20c0000000000000000000000000000000000000'; // testnet pathUSD
  // Convert "0.01" → "10000" base units (6 decimals TIP-20).
  const amountBaseUnits = Math.round(parseFloat(c2paVerify.price.amount) * 1_000_000).toString();
  const host = new URL(c.req.url).host;
  const baseUrl = `https://${host}`;

  return c.json({
    openapi: '3.1.0',
    info: {
      title: c2paVerify.name,
      version: '0.1.3',
      description: c2paVerify.description,
      // Short agent-readable hint rendered by MPPScan и other aggregators.
      // Keep it terse — target audience is automated clients, not humans.
      'x-guidance':
        'POST /verify with multipart file upload (image/video/audio, ≤25MB) OR JSON {"url": "https://..."} to extract and validate an embedded C2PA manifest. Requires MPP payment (0.01 USDC.e on Tempo mainnet). Response contains trust_chain classification (valid | partial | unknown), signed_by, claim_generator, and assertion labels. Free endpoints: GET /health, GET /llms.txt, GET /openapi.json, GET /.',
    },
    servers: [{ url: baseUrl }],
    // Document-level security scheme — Payment HTTP auth per MPP spec.
    // Free routes MUST set `security: []` to override this default;
    // paid routes reference it via `security: [{ mppPayment: [] }]`.
    components: {
      securitySchemes: {
        mppPayment: {
          type: 'http',
          scheme: 'Payment',
          description:
            'MPP (Machine Payments Protocol) — Tempo mainnet USDC.e via mppx SDK',
        },
      },
    },
    'x-service-info': {
      categories: c2paVerify.categories,
      docs: {
        homepage: baseUrl,
        apiReference: `${baseUrl}/`,
        llms: `${baseUrl}/llms.txt`,
      },
    },
    paths: {
      '/verify': {
        post: {
          summary: 'Verify C2PA manifest on uploaded or fetched asset',
          description:
            'Accepts multipart file upload or JSON {url}. Returns extracted C2PA manifest with trust_chain classification (valid | partial | unknown) and warnings.',
          // Explicit auth requirement для MPPScan / agents.
          security: [{ mppPayment: [] }],
          'x-payment-info': {
            // MPPScan expects `price` (not `amount`) as primary budget hint.
            // Keep `amount` as alias for backward-compat with earlier clients.
            price: amountBaseUnits,
            amount: amountBaseUnits,
            currency,
            description: `C2PA verification (${c2paVerify.id})`,
            intent: 'charge',
            method: 'tempo',
            protocols: ['mpp'],
          },
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                  },
                },
              },
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                  },
                  required: ['url'],
                },
              },
            },
          },
          responses: {
            '200': { description: 'Verification result with manifest' },
            '402': { description: 'Payment Required (MPP challenge)' },
            '413': { description: 'Asset too large (>25MB)' },
            '415': { description: 'Unsupported media type' },
            '422': { description: 'Invalid asset or no C2PA manifest' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      // Free routes: `security: []` (empty) explicitly overrides any
      // document-level default и signals "no auth needed" per OpenAPI 3.1.
      // MPPScan interprets presence of `x-payment-info` as "paid route" —
      // so free routes MUST NOT include that object at all.
      '/health': {
        get: {
          summary: 'Service health check',
          security: [],
          responses: { '200': { description: 'Service is healthy' } },
        },
      },
      '/llms.txt': {
        get: {
          summary: 'Agent-readable service spec',
          security: [],
          responses: {
            '200': { description: 'Plain-text spec for LLM consumption' },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'MPP discovery document (this file)',
          security: [],
          responses: {
            '200': { description: 'OpenAPI 3.1 document with x-payment-info' },
          },
        },
      },
      '/': {
        get: {
          summary: 'Service metadata (JSON)',
          security: [],
          responses: {
            '200': { description: 'Service id, name, endpoints, price' },
          },
        },
      },
    },
  });
});

// ── Favicon ─────────────────────────────────────────────────
// Inline SVG — zero-size deploy, MPPScan и browsers happy.
// Design: C2PA diamond (content credentials icon) stylized.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f172a"/><path d="M32 10 L54 32 L32 54 L10 32 Z" fill="none" stroke="#22d3ee" stroke-width="3"/><text x="32" y="40" font-family="monospace" font-size="18" font-weight="bold" text-anchor="middle" fill="#22d3ee">C2</text></svg>`;

app.get('/favicon.svg', c => {
  return c.body(FAVICON_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  });
});

app.get('/favicon.ico', c => {
  // Browsers fall back to SVG if served as image/svg+xml via .ico path.
  return c.body(FAVICON_SVG, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  });
});

// ── Paid endpoint: /verify ──────────────────────────────────
app.post('/verify', async c => {
  if (c2paVerify.status === 'disabled') {
    return c.json({ error: 'service disabled', id: c2paVerify.id }, 410);
  }
  if (c2paVerify.status === 'deprecated') {
    c.header('x-service-deprecated', 'true');
  }

  const adapter = getAdapter(c.env);
  const requirement: PaymentRequirement = {
    amount: c2paVerify.price.amount,
    currency: c2paVerify.price.currency,
    recipient: c.env.MPP_RECIPIENT_ADDRESS,
    network: 'tempo',
    serviceId: c2paVerify.id,
  };

  const priceUsd = parseFloat(c2paVerify.price.amount);
  const upstreamCost = c2paVerify.upstreamCost ?? 0;

  return wrapHandler(c, c2paVerify.id, priceUsd, upstreamCost, async () => {
    let verification;
    try {
      verification = await adapter.verify(c.req.raw, requirement);
    } catch (err) {
      console.error('[c2pa-verify] payment verification error:', err);
      return c.json(
        { error: 'payment verification failed', service: c2paVerify.id },
        503,
      );
    }

    if (!verification || !verification.verified) {
      return adapter.create402(requirement, c.req.raw);
    }

    let response: Response;
    try {
      response = await c2paVerify.handler(c);
    } catch (err) {
      console.error('[c2pa-verify] handler error:', err);
      return c.json(
        { error: 'service handler error', service: c2paVerify.id },
        500,
      );
    }

    return adapter.attachReceipt(response, verification);
  });
});

// ── Error handlers ──────────────────────────────────────────
app.notFound(c => {
  return c.json(
    {
      error: 'not found',
      service: c2paVerify.id,
      hint: 'GET / for service info, POST /verify for verification.',
    },
    404,
  );
});

app.onError((err, c) => {
  console.error('[c2pa-verify] unhandled error:', err);
  return c.json({ error: 'internal server error', service: c2paVerify.id }, 500);
});

export default app;
