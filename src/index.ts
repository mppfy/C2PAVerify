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
import { createX402Adapter } from './_vendor/adapters/x402';
import { createMultiProtocolAdapter } from './_vendor/adapters/multi';
import type { PaymentAdapter, PaymentRequirement } from './_vendor/adapters/types';
import { wrapHandler } from './_vendor/core/observability';
import { c2paVerify } from './service';
import { renderLanding } from './landing';
import { captureException } from './observability/sentry';
import { sendLog } from './observability/axiom';

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
  } else if (mode === 'x402') {
    cachedAdapter = buildX402Adapter(env);
  } else if (mode === 'multi') {
    // Dual protocol — dispatch between MPP and x402 based on request hints.
    // Default protocol flips from 'mpp' → 'x402' after 7 days of clean prod
    // traffic (see DEFAULT_PROTOCOL env override).
    const mpp = createMPPAdapter({
      recipientAddress: env.MPP_RECIPIENT_ADDRESS,
      secretKey: env.MPP_SECRET_KEY,
      testnet: env.ENVIRONMENT !== 'production',
    });
    const x402 = buildX402Adapter(env);
    cachedAdapter = createMultiProtocolAdapter({
      adapters: { mpp, x402 },
      detection: {
        defaultProtocol: env.DEFAULT_PROTOCOL ?? 'mpp',
      },
    });
  } else {
    throw new Error(`Unknown PAYMENT_MODE: ${mode}`);
  }
  return cachedAdapter;
}

function buildX402Adapter(env: ServiceEnv): PaymentAdapter {
  const recipient = env.X402_RECIPIENT_ADDRESS ?? env.MPP_RECIPIENT_ADDRESS;
  if (!recipient) {
    throw new Error('X402 mode requires X402_RECIPIENT_ADDRESS or MPP_RECIPIENT_ADDRESS');
  }
  const network: 'base' | 'base-sepolia' =
    env.X402_NETWORK ?? (env.ENVIRONMENT === 'production' ? 'base' : 'base-sepolia');

  // Parse seed-payer list (comma-separated 0x... addresses). Empty/undefined
  // → empty list → no addresses tagged as seed (all traffic = organic).
  // See docs/x402-roadmap.md for rationale.
  const seedPayers = env.X402_SEED_PAYERS
    ? env.X402_SEED_PAYERS.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
    : [];

  // Parse timeout override если задан. Invalid строка → ignore.
  const timeoutMs = env.X402_FACILITATOR_TIMEOUT_MS
    ? Number.parseInt(env.X402_FACILITATOR_TIMEOUT_MS, 10)
    : Number.NaN;

  return createX402Adapter({
    recipientAddress: recipient,
    network,
    ...(env.X402_FACILITATOR_URL ? { facilitatorUrl: env.X402_FACILITATOR_URL } : {}),
    ...(env.X402_FACILITATOR_FALLBACK_URL
      ? { facilitatorFallbackUrl: env.X402_FACILITATOR_FALLBACK_URL }
      : {}),
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0
      ? { facilitatorTimeoutMs: timeoutMs }
      : {}),
    ...(env.X402_ASSET_ADDRESS ? { assetAddress: env.X402_ASSET_ADDRESS } : {}),
    ...(seedPayers.length > 0 ? { seedPayers } : {}),
  });
}

// ── Free endpoints ──────────────────────────────────────────
//
// Host-based routing: one worker serves both mppfy.com apex (marketing
// landing) and c2pa.mppfy.com (API metadata JSON). Keeps infra minimal;
// landing HTML is cached aggressively at edge.
app.get('/', c => {
  const host = (c.req.header('host') ?? '').toLowerCase();
  const isApex = host === 'mppfy.com' || host === 'www.mppfy.com';

  if (isApex) {
    return renderLanding();
  }

  // c2pa.mppfy.com (API subdomain) — return machine-readable service metadata.
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
  // MPPScan expects `price` as decimal-formatted USD string with 6 digits
  // of fractional precision (e.g. "0.010000" for $0.01, "2.000000" for $2.00).
  // Anything else is displayed as-is: "10000" renders as $10,000.00.
  const priceUsdDecimal = parseFloat(c2paVerify.price.amount).toFixed(6);
  const host = new URL(c.req.url).host;
  const baseUrl = `https://${host}`;

  // Whether x402 is advertised in discovery. True when PAYMENT_MODE is
  // 'x402' or 'multi'. In pure 'mpp' mode we omit x402 entirely so discovery
  // reflects runtime capability truthfully.
  const x402Active = c.env.PAYMENT_MODE === 'x402' || c.env.PAYMENT_MODE === 'multi';
  const x402Network: 'base' | 'base-sepolia' =
    c.env.X402_NETWORK ?? (isProd ? 'base' : 'base-sepolia');
  // USDC on Base — per Circle docs. Used for x402 discovery metadata only.
  const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const x402Asset =
    c.env.X402_ASSET_ADDRESS ??
    (x402Network === 'base' ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA);
  const x402Recipient = c.env.X402_RECIPIENT_ADDRESS ?? c.env.MPP_RECIPIENT_ADDRESS;
  // USDC has 6 decimals on Base too. "0.01" → "10000" atomic units.
  const x402AtomicAmount = Math.round(
    parseFloat(c2paVerify.price.amount) * 1_000_000,
  ).toString();

  const paidProtocols: string[] = ['mpp'];
  if (x402Active) paidProtocols.push('x402');

  // Shape copied from a working registered service (AgentMail):
  //   free route →  x-payment-info: { protocols:['mpp'], pricingMode:'fixed', price:'0' }
  //   paid route →  x-payment-info: { ..., price, currency, method, intent, protocols, pricingMode }
  // MPPScan classifies purely by `x-payment-info.price` — '0' means free
  // even though an x-payment-info object is present. The earlier "authMode"
  // hint in MPPScan's warning text was misleading; none of the registered
  // services use it.
  const freePayment = {
    protocols: ['mpp'],
    pricingMode: 'fixed',
    price: '0',
  };

  return c.json({
    openapi: '3.1.0',
    info: {
      title: c2paVerify.name,
      version: '0.2.0',
      description: c2paVerify.description,
      // Short agent-readable hint rendered by MPPScan и other aggregators.
      // Keep it terse — target audience is automated clients, not humans.
      'x-guidance': x402Active
        ? 'POST /verify with multipart file upload (image/video/audio, ≤25MB) OR JSON {"url": "https://..."} to extract and validate an embedded C2PA manifest. Dual-protocol: MPP (0.01 USDC.e on Tempo) or x402 (0.01 USDC on Base). Clients pick protocol via `Authorization: Payment` (MPP) or `X-PAYMENT` (x402) header; override with `x-payment-protocol: mpp|x402`. Response contains trust_chain classification (valid | partial | unknown), signed_by, claim_generator, and assertion labels. Free endpoints: GET /health, GET /llms.txt, GET /openapi.json, GET /.'
        : 'POST /verify with multipart file upload (image/video/audio, ≤25MB) OR JSON {"url": "https://..."} to extract and validate an embedded C2PA manifest. Requires MPP payment (0.01 USDC.e on Tempo mainnet). Response contains trust_chain classification (valid | partial | unknown), signed_by, claim_generator, and assertion labels. Free endpoints: GET /health, GET /llms.txt, GET /openapi.json, GET /.',
    },
    servers: [{ url: baseUrl }],
    'x-service-info': {
      categories: c2paVerify.categories,
      docs: {
        homepage: baseUrl,
        apiReference: `${baseUrl}/`,
        llms: `${baseUrl}/llms.txt`,
      },
    },
    // x402 discovery metadata — parsed by x402-aware clients и бьётся с
    // `accepts: PaymentRequirements[]` в runtime 402 response на /verify.
    // Shape mirrors PaymentRequirements from x402/types@1.1.0. Present only
    // when x402 is active (PAYMENT_MODE='x402' or 'multi').
    ...(x402Active
      ? {
          'x-x402': {
            version: 1,
            network: x402Network,
            accepts: [
              {
                scheme: 'exact',
                network: x402Network,
                maxAmountRequired: x402AtomicAmount,
                resource: `${baseUrl}/verify`,
                description: `C2PA verification (${c2paVerify.id})`,
                mimeType: 'application/json',
                payTo: x402Recipient,
                maxTimeoutSeconds: 300,
                asset: x402Asset,
                extra: { name: 'USD Coin', version: '2' },
              },
            ],
          },
        }
      : {}),
    paths: {
      '/verify': {
        post: {
          summary: 'Verify C2PA manifest on uploaded or fetched asset',
          description:
            'Accepts multipart file upload or JSON {url}. Returns extracted C2PA manifest with trust_chain classification (valid | partial | unknown) and warnings.',
          'x-payment-info': {
            protocols: paidProtocols,
            pricingMode: 'fixed',
            // Decimal-formatted USD string (6 fractional digits).
            // MPPScan renders this directly as $price.
            price: priceUsdDecimal,
            // Base-unit fields for mppx SDK / 402 challenge compatibility.
            // MPP-oriented fields — x402 clients read top-level `x-x402`.
            amount: amountBaseUnits,
            currency,
            method: 'tempo',
            intent: 'charge',
            description: `C2PA verification (${c2paVerify.id})`,
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
            '402': {
              description: x402Active
                ? 'Payment Required — MPP (WWW-Authenticate) or x402 ({ accepts: PaymentRequirements[] }) challenge depending on client hint'
                : 'Payment Required (MPP challenge)',
            },
            '413': { description: 'Asset too large (>25MB)' },
            '415': { description: 'Unsupported media type' },
            '422': { description: 'Invalid asset or no C2PA manifest' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Service health check',
          'x-payment-info': freePayment,
          responses: { '200': { description: 'Service is healthy' } },
        },
      },
      '/llms.txt': {
        get: {
          summary: 'Agent-readable service spec',
          'x-payment-info': freePayment,
          responses: {
            '200': { description: 'Plain-text spec for LLM consumption' },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'MPP discovery document (this file)',
          'x-payment-info': freePayment,
          responses: {
            '200': { description: 'OpenAPI 3.1 document with x-payment-info' },
          },
        },
      },
      '/': {
        get: {
          summary: 'Service metadata (JSON)',
          'x-payment-info': freePayment,
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
// NOTE: GET/HEAD/OPTIONS handlers были добавлены в v0.1.6 чтобы MPPScan
// мог сверить заявленную в openapi цену через probe — но это ломало
// schema validation (MPPScan классифицировал каждый метод как отдельный
// paid endpoint и требовал requestBody schema, которой нет у GET).
// Оставляем POST-only; MPPScan fallback — читать цену из /openapi.json.
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
      const sentryId = captureException(err, {
        dsn: c.env.SENTRY_DSN,
        release: c.env.SENTRY_RELEASE,
        environment: c.env.ENVIRONMENT,
        executionCtx: c.executionCtx,
        request: c.req.raw,
        serverName: `c2pa-verify@${c.env.ENVIRONMENT}`,
      });
      sendLog(c.env, c.executionCtx, {
        level: 'error',
        service: c2paVerify.id,
        event: 'handler_error',
        error_name: err instanceof Error ? err.name : 'unknown',
        error_message: err instanceof Error ? err.message : String(err),
        sentry_id: sentryId ?? undefined,
      });
      return c.json(
        {
          error: 'service handler error',
          service: c2paVerify.id,
          ...(sentryId ? { trace_id: sentryId } : {}),
        },
        500,
      );
    }

    // Attach sync receipt markers (protocol/network/payer headers).
    let withReceipt = adapter.attachReceipt(response, verification);

    // Finalize async settlement (x402: facilitator.settle() → on-chain
    // USDC transfer → X-PAYMENT-RESPONSE header). For MPP this is a no-op.
    // Only runs on 2xx handler outcomes — see adapter.settle() guard.
    if (adapter.settle) {
      try {
        withReceipt = await adapter.settle(c.req.raw, withReceipt, verification);
      } catch (err) {
        // settle() already logs internally and returns response-as-is on
        // failure; this catch is a safety net for unexpected throws.
        console.error('[c2pa-verify] settle step threw:', err);
      }
    }

    return withReceipt;
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
  const sentryId = captureException(err, {
    dsn: c.env.SENTRY_DSN,
    release: c.env.SENTRY_RELEASE,
    environment: c.env.ENVIRONMENT,
    executionCtx: c.executionCtx,
    request: c.req.raw,
    serverName: `c2pa-verify@${c.env.ENVIRONMENT}`,
  });
  sendLog(c.env, c.executionCtx, {
    level: 'error',
    service: c2paVerify.id,
    event: 'unhandled_error',
    error_name: err instanceof Error ? err.name : 'unknown',
    error_message: err instanceof Error ? err.message : String(err),
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    sentry_id: sentryId ?? undefined,
  });
  return c.json(
    {
      error: 'internal server error',
      service: c2paVerify.id,
      ...(sentryId ? { trace_id: sentryId } : {}),
    },
    500,
  );
});

export default app;
