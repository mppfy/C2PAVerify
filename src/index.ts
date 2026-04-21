/**
 * C2PAVerify — Cloudflare Worker entry point.
 *
 * Single-service MPPFY deployment. Routes:
 *   GET  /                                  — service metadata (free)
 *   GET  /  [Accept: text/markdown]         — llms.txt payload (free)
 *   GET  /llms.txt                          — agent-friendly spec (free)
 *   GET  /openapi.json                      — OpenAPI 3.1 discovery (free)
 *   GET  /robots.txt                        — AI bot rules + sitemap (free)
 *   GET  /sitemap.xml                       — public URL sitemap (free)
 *   GET  /.well-known/mpp-services          — RFC 8615 alias → openapi.json
 *   GET  /.well-known/api-catalog           — RFC 9727 service-desc linkset
 *   GET  /.well-known/mcp/server-card.json  — MCP server manifest (stdio)
 *   GET  /health                            — health check (free)
 *   POST /verify                            — C2PA verification (paid, 402)
 *
 * All free discovery routes return `Link` headers pointing at the canonical
 * machine-readable spec (`/openapi.json`), so clients doing a single HEAD
 * request can follow the service-desc rel to discovery without probing paths.
 */

import { Hono } from 'hono';
import type { ServiceEnv } from './_vendor/core/types';
import { createMPPAdapter } from './_vendor/adapters/mpp';
import { noneAdapter } from './_vendor/adapters/none';
import { createX402Adapter } from './_vendor/adapters/x402';
import {
  createFacilitatorClient,
  createFacilitatorPool,
  type FacilitatorPool,
  type PoolPrimary,
} from './_vendor/adapters/x402-facilitator';
import {
  isCdpFacilitatorUrl,
  parseFacilitatorUrl,
} from './_vendor/adapters/x402-url';
import { createCdpAuthHeaders } from '@coinbase/x402';
import { createMultiProtocolAdapter } from './_vendor/adapters/multi';
import type { PaymentAdapter, PaymentRequirement } from './_vendor/adapters/types';
import { wrapHandler } from './_vendor/core/observability';
import { c2paVerify } from './service';
import { renderLanding } from './landing';
import { TERMS, PRIVACY, legalResponse } from './legal';
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

/**
 * Default label derived from host when URL entry has no `|label` suffix.
 * Examples:
 *   https://facilitator.payai.network        → "payai"
 *   https://api.cdp.coinbase.com/platform/v2 → "cdp"
 *   https://x402.org/facilitator             → "x402-public"
 */
function defaultLabelFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes('payai')) return 'payai';
    if (host.includes('cdp.coinbase')) return 'cdp';
    if (host.includes('x402.org')) return 'x402-public';
    return host.replace(/\..*$/, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Parse `X402_FACILITATOR_URLS` — comma-separated list with optional
 * `|label` suffix per entry. Empty / undefined → empty array (caller
 * falls back to legacy single-URL mode).
 *
 * Grammar: `url[|label](,url[|label])*`
 *
 * Example:
 *   "https://facilitator.payai.network|payai,https://api.cdp.coinbase.com/platform/v2/x402|cdp"
 */
function parseFacilitatorUrls(
  raw: string | undefined,
): Array<{ url: string; label: string }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => {
      const pipeIdx = entry.indexOf('|');
      if (pipeIdx === -1) {
        return { url: entry, label: defaultLabelFor(entry) };
      }
      return {
        url: entry.slice(0, pipeIdx).trim(),
        label: entry.slice(pipeIdx + 1).trim() || defaultLabelFor(entry),
      };
    });
}

/**
 * Build the facilitator pool from env. Two modes:
 *
 * 1. **Pool mode** — `X402_FACILITATOR_URLS` is set. Each primary URL
 *    becomes a pool entry. CDP URLs (`api.cdp.coinbase.com`) auto-inject
 *    `createCdpAuthHeaders(X402_CDP_API_KEY_ID, X402_CDP_API_KEY_SECRET)`
 *    for JWT auth. Non-CDP URLs stay no-auth.
 *
 * 2. **Single-primary legacy** — only `X402_FACILITATOR_URL` set (e.g.
 *    PayAI only). One primary, no CDP auth.
 *
 * Fallback facilitator (`x402.org/facilitator`, no catalog but reliable)
 * is always added unless the only primary already equals it.
 */
function buildFacilitatorPool(env: ServiceEnv): FacilitatorPool {
  const timeoutMs = env.X402_FACILITATOR_TIMEOUT_MS
    ? Number.parseInt(env.X402_FACILITATOR_TIMEOUT_MS, 10)
    : Number.NaN;
  const timeoutOpt =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {};

  const poolEntries = parseFacilitatorUrls(env.X402_FACILITATOR_URLS);
  const primaryUrls: Array<{ url: string; label: string }> =
    poolEntries.length > 0
      ? poolEntries
      : env.X402_FACILITATOR_URL
        ? [
            {
              url: env.X402_FACILITATOR_URL,
              label: defaultLabelFor(env.X402_FACILITATOR_URL),
            },
          ]
        : [{ url: 'https://x402.org/facilitator', label: 'x402-public' }];

  const primaries: PoolPrimary[] = primaryUrls.map(({ url, label }) => {
    // Reject plaintext HTTP early — facilitator payloads include EIP-712
    // signatures + payer addresses; silently forwarding those over http://
    // would be a privacy regression and a signal of operator misconfig.
    const parsed = parseFacilitatorUrl(url); // throws on http:// or malformed

    // CDP detection via EXACT hostname match (see x402-url.ts rationale).
    // NEVER use substring matching here — credential exfiltration risk.
    const isCdp = isCdpFacilitatorUrl(url);
    const createAuthHeaders =
      isCdp && env.X402_CDP_API_KEY_ID && env.X402_CDP_API_KEY_SECRET
        ? createCdpAuthHeaders(env.X402_CDP_API_KEY_ID, env.X402_CDP_API_KEY_SECRET)
        : undefined;

    if (isCdp && !createAuthHeaders) {
      console.warn(
        `[x402] CDP facilitator URL configured (${parsed.hostname}) but X402_CDP_API_KEY_ID/SECRET missing — calls will be unauthenticated and rejected by CDP`,
      );
    }

    return {
      client: createFacilitatorClient({
        url,
        // Disable legacy single-URL fallback inside each client — the pool
        // handles fallback coherently at verify-time (one shared fallback,
        // not one per primary).
        fallbackUrl: url,
        ...timeoutOpt,
        ...(createAuthHeaders ? { createAuthHeaders } : {}),
      }),
      label,
    };
  });

  // Always add x402.org as pool-level fallback unless it's already a
  // primary (redundant). No auth, no catalog, but always available.
  const fallbackUrl =
    env.X402_FACILITATOR_FALLBACK_URL ?? 'https://x402.org/facilitator';
  const fallbackAlreadyPrimary = primaries.some(
    p => p.client.url === fallbackUrl,
  );
  const fallback: PoolPrimary | undefined = fallbackAlreadyPrimary
    ? undefined
    : {
        client: createFacilitatorClient({
          url: fallbackUrl,
          fallbackUrl, // no cascading
          ...timeoutOpt,
        }),
        label: defaultLabelFor(fallbackUrl),
      };

  return createFacilitatorPool({
    primaries,
    ...(fallback ? { fallback } : {}),
  });
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

  return createX402Adapter({
    recipientAddress: recipient,
    network,
    facilitatorPool: buildFacilitatorPool(env),
    ...(env.X402_ASSET_ADDRESS ? { assetAddress: env.X402_ASSET_ADDRESS } : {}),
    ...(seedPayers.length > 0 ? { seedPayers } : {}),
  });
}

// ── Free endpoints ──────────────────────────────────────────
//
// Host-based routing: one worker serves both mppfy.com apex (marketing
// landing) and c2pa.mppfy.com (API metadata JSON). Keeps infra minimal;
// landing HTML is cached aggressively at edge.

/**
 * Single source of truth for the agent-readable spec. Returned by both
 * /llms.txt (Content-Type: text/plain) and GET / with `Accept: text/markdown`
 * (Content-Type: text/markdown) so Markdown-content-negotiation crawlers
 * and plain-text llms.txt readers both resolve to the same canonical text.
 */
function buildLlmsTxt(): string {
  return `# ${c2paVerify.name}

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
OpenAPI discovery: GET /openapi.json (alias: GET /.well-known/mpp-services)

## Categories
${c2paVerify.categories.join(', ')}

## Status
${c2paVerify.status}

## Source
https://github.com/mppfy/C2PAVerify
`;
}

/**
 * RFC 8288 Link header advertising machine-readable specs на homepage.
 * Agents doing HEAD / can follow `service-desc` → OpenAPI, `alternate` →
 * markdown/plain variants без дополнительного probing. Keeps discovery
 * cheap (one round-trip) for crawlers like isitagentready.com.
 */
const DISCOVERY_LINK_HEADER = [
  '</openapi.json>; rel="service-desc"; type="application/json"',
  '</.well-known/mpp-services>; rel="service-desc"; type="application/json"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</.well-known/mcp/server-card.json>; rel="mcp-server"; type="application/json"',
  '</llms.txt>; rel="alternate"; type="text/plain"',
  // RFC 8288 `rel="terms-of-service"` + `rel="privacy-policy"` — surfaced
  // so crawlers and agent discovery loops (e.g. isitagentready) pick up
  // legal docs without parsing OpenAPI. Markdown content-type reflected.
  '</legal/terms>; rel="terms-of-service"; type="text/markdown"',
  '</legal/privacy>; rel="privacy-policy"; type="text/markdown"',
].join(', ');

app.get('/', c => {
  const host = (c.req.header('host') ?? '').toLowerCase();
  const isApex = host === 'mppfy.com' || host === 'www.mppfy.com';

  if (isApex) {
    return renderLanding();
  }

  // Markdown content negotiation (see cloudflare.com/fundamentals/reference/
  // markdown-for-agents). If the caller prefers markdown, return llms.txt
  // payload with Content-Type: text/markdown — same string, different label.
  const accept = (c.req.header('accept') ?? '').toLowerCase();
  if (accept.includes('text/markdown')) {
    return c.text(buildLlmsTxt(), 200, {
      'content-type': 'text/markdown; charset=utf-8',
      link: DISCOVERY_LINK_HEADER,
    });
  }

  // c2pa.mppfy.com (API subdomain) — return machine-readable service metadata.
  c.header('link', DISCOVERY_LINK_HEADER);
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
      wellKnown: 'GET /.well-known/mpp-services',
      apiCatalog: 'GET /.well-known/api-catalog',
      mcpServerCard: 'GET /.well-known/mcp/server-card.json',
      robots: 'GET /robots.txt',
      sitemap: 'GET /sitemap.xml',
      health: 'GET /health',
      verify: 'POST /verify',
    },
    mpp_protocol: 'https://mpp.dev',
    docs: 'https://github.com/mppfy/C2PAVerify',
  });
});

app.get('/llms.txt', c => {
  return c.text(buildLlmsTxt(), 200, {
    'content-type': 'text/plain; charset=utf-8',
  });
});

app.get('/health', c => {
  return c.json({ status: 'ok', service: c2paVerify.id, env: c.env.ENVIRONMENT });
});

// ── Legal docs ──────────────────────────────────────────────
// Served as markdown (text/plain on explicit Accept: text/plain).
// Agents reaching /openapi.json get `info.termsOfService` pointing here.
// The markdown itself is embedded at build time from docs/legal/*.md; see
// src/legal.ts + wrangler.toml Text rule.
app.get('/legal/terms', c =>
  legalResponse(TERMS, c.req.header('accept') ?? ''),
);
app.get('/legal/privacy', c =>
  legalResponse(PRIVACY, c.req.header('accept') ?? ''),
);

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
 *
 * Served at two paths:
 *   - /openapi.json                  — canonical MPP discovery URL
 *   - /.well-known/mpp-services      — RFC 8615 well-known alias
 * Both return identical payload; second form is surfaced for crawlers that
 * probe `/.well-known/*` by convention (e.g. aggregators scanning new hosts).
 */
function buildOpenApiSpec(
  env: ServiceEnv,
  requestUrl: string,
): Record<string, unknown> {
  const isProd = env.ENVIRONMENT === 'production';
  const currency = isProd
    ? '0x20C000000000000000000000b9537d11c60E8b50' // mainnet bridged USDC
    : '0x20c0000000000000000000000000000000000000'; // testnet pathUSD
  // Convert "0.01" → "10000" base units (6 decimals TIP-20).
  const amountBaseUnits = Math.round(parseFloat(c2paVerify.price.amount) * 1_000_000).toString();
  // MPPScan expects `price` as decimal-formatted USD string with 6 digits
  // of fractional precision (e.g. "0.010000" for $0.01, "2.000000" for $2.00).
  // Anything else is displayed as-is: "10000" renders as $10,000.00.
  const priceUsdDecimal = parseFloat(c2paVerify.price.amount).toFixed(6);
  const host = new URL(requestUrl).host;
  const baseUrl = `https://${host}`;

  // Whether x402 is advertised in discovery. True when PAYMENT_MODE is
  // 'x402' or 'multi'. In pure 'mpp' mode we omit x402 entirely so discovery
  // reflects runtime capability truthfully.
  const x402Active = env.PAYMENT_MODE === 'x402' || env.PAYMENT_MODE === 'multi';
  const x402Network: 'base' | 'base-sepolia' =
    env.X402_NETWORK ?? (isProd ? 'base' : 'base-sepolia');
  // USDC on Base — per Circle docs. Used for x402 discovery metadata only.
  const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const x402Asset =
    env.X402_ASSET_ADDRESS ??
    (x402Network === 'base' ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA);
  const x402Recipient = env.X402_RECIPIENT_ADDRESS ?? env.MPP_RECIPIENT_ADDRESS;
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

  return {
    openapi: '3.1.0',
    info: {
      title: c2paVerify.name,
      version: '0.2.0',
      description: c2paVerify.description,
      // OpenAPI 3.1 `termsOfService` (URI): surfaces ToS to agents that
      // parse discovery. Keep value ABSOLUTE — many OpenAPI parsers do
      // not resolve it against `servers[].url`.
      termsOfService: `${baseUrl}/legal/terms`,
      // Short agent-readable hint rendered by MPPScan и other aggregators.
      // Keep it terse — target audience is automated clients, not humans.
      'x-guidance': x402Active
        ? 'POST /verify with multipart file upload (image/video/audio, ≤25MB) OR JSON {"url": "https://..."} to extract and validate an embedded C2PA manifest. Dual-protocol: MPP (0.01 USDC.e on Tempo) or x402 (0.01 USDC on Base). Clients pick protocol via `Authorization: Payment` (MPP) or `X-PAYMENT` (x402) header; override with `x-payment-protocol: mpp|x402`. Response contains trust_chain classification (valid | partial | unknown), signed_by, claim_generator, and assertion labels. Free endpoints: GET /health, GET /llms.txt, GET /openapi.json, GET /.well-known/mpp-services, GET /.'
        : 'POST /verify with multipart file upload (image/video/audio, ≤25MB) OR JSON {"url": "https://..."} to extract and validate an embedded C2PA manifest. Requires MPP payment (0.01 USDC.e on Tempo mainnet). Response contains trust_chain classification (valid | partial | unknown), signed_by, claim_generator, and assertion labels. Free endpoints: GET /health, GET /llms.txt, GET /openapi.json, GET /.well-known/mpp-services, GET /.',
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
      '/.well-known/mpp-services': {
        get: {
          summary: 'RFC 8615 well-known alias for /openapi.json',
          'x-payment-info': freePayment,
          responses: {
            '200': { description: 'Same payload as GET /openapi.json' },
          },
        },
      },
      '/.well-known/api-catalog': {
        get: {
          summary: 'RFC 9727 API-catalog linkset',
          'x-payment-info': freePayment,
          responses: {
            '200': {
              description: 'application/linkset+json pointing at service-desc, service-doc, service-meta',
            },
          },
        },
      },
      '/.well-known/mcp/server-card.json': {
        get: {
          summary: 'MCP server manifest (@mppfy/c2pa-verify-mcp, stdio transport)',
          'x-payment-info': freePayment,
          responses: {
            '200': {
              description: 'Tool catalog, transport, and installation hints for MCP hosts',
            },
          },
        },
      },
      '/legal/terms': {
        get: {
          summary: 'Terms of Service (markdown)',
          'x-payment-info': freePayment,
          responses: {
            '200': {
              description: 'text/markdown body with binding service terms',
            },
          },
        },
      },
      '/legal/privacy': {
        get: {
          summary: 'Privacy Policy (markdown)',
          'x-payment-info': freePayment,
          responses: {
            '200': {
              description: 'text/markdown body with data processing policy',
            },
          },
        },
      },
      '/robots.txt': {
        get: {
          summary: 'robots.txt with AI-bot allow rules and sitemap link',
          'x-payment-info': freePayment,
          responses: {
            '200': { description: 'text/plain robots.txt' },
          },
        },
      },
      '/sitemap.xml': {
        get: {
          summary: 'sitemap.xml listing public discovery URLs',
          'x-payment-info': freePayment,
          responses: {
            '200': { description: 'application/xml sitemap' },
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
  };
}

app.get('/openapi.json', c => c.json(buildOpenApiSpec(c.env, c.req.url)));

// RFC 8615 well-known alias — surfaces the same OpenAPI spec for crawlers
// that probe `/.well-known/*` по конвенции. Kept intentionally identical
// to /openapi.json so aggregators do not have to special-case the endpoint.
app.get('/.well-known/mpp-services', c =>
  c.json(buildOpenApiSpec(c.env, c.req.url)),
);

// ── Agent-readiness discovery ───────────────────────────────
//
// The checks below surface our service to crawlers following the emerging
// "agent-ready" conventions (tested by cloudflare's isitagentready.com).
// All are read-only, cheap, and deterministic — no runtime deps, no secrets.

/**
 * robots.txt with explicit AI-bot allow rules + Content-Signals directive
 * per Cloudflare's content-signals convention (blog.cloudflare.com/content-signals).
 * We intentionally allow all major AI crawlers: this is a paid API — agents
 * benefit from reading /openapi.json and /llms.txt to pick it up.
 *
 * Apex domain (mppfy.com landing) gets a narrower robots.txt served from the
 * same handler; host is checked to avoid leaking subdomain-specific sitemap.
 */
app.get('/robots.txt', c => {
  // Prefer URL host to Host header — vitest-pool-workers does not populate
  // a Host header on SELF.fetch, but c.req.url is always complete.
  const host = new URL(c.req.url).host.toLowerCase();
  const isApex = host === 'mppfy.com' || host === 'www.mppfy.com';
  const baseUrl = isApex ? 'https://mppfy.com' : `https://${host}`;

  // NOTE: Content-Signal MUST be within the first ~512 bytes of robots.txt
  // because scanners (isitagentready.com) only parse a body preview. We put
  // it in the wildcard User-agent group, directly after Allow, per Cloudflare
  // content-signals spec (blog.cloudflare.com/content-signals). Long prose
  // comments go to the bottom so preview-truncated parsers still catch the
  // directive.
  const body = `User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=no

Sitemap: ${baseUrl}/sitemap.xml

# Explicit allow for major AI crawlers — content here is a paid API
# (POST /verify). Marketing copy and discovery endpoints are fine to index.
User-agent: ClaudeBot
Allow: /

User-agent: GPTBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Meta-ExternalAgent
Allow: /

User-agent: CCBot
Allow: /

# ${isApex ? 'MPPFY' : 'C2PAVerify'} — robots.txt (generated; edit src/index.ts)
# Content-Signal semantics:
#   search=yes    — allow traditional search indexing.
#   ai-input=yes  — allow RAG / prompt-time retrieval.
#   ai-train=no   — public copy OK, don't train foundation models on paid API output.
`;
  return c.text(body, 200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

/**
 * sitemap.xml listing publicly discoverable URLs. `lastmod` uses deploy
 * timestamp so crawlers refetch after each release; `priority` values follow
 * sitemaps.org conventions (1.0 = homepage, 0.9 = primary spec, etc.).
 */
app.get('/sitemap.xml', c => {
  const host = new URL(c.req.url).host.toLowerCase();
  const isApex = host === 'mppfy.com' || host === 'www.mppfy.com';
  const baseUrl = isApex ? 'https://mppfy.com' : `https://${host}`;
  const today = new Date().toISOString().split('T')[0];

  const urls = isApex
    ? [{ loc: baseUrl, priority: '1.0', changefreq: 'monthly' }]
    : [
        { loc: baseUrl, priority: '1.0', changefreq: 'weekly' },
        { loc: `${baseUrl}/openapi.json`, priority: '0.9', changefreq: 'weekly' },
        { loc: `${baseUrl}/llms.txt`, priority: '0.9', changefreq: 'weekly' },
        {
          loc: `${baseUrl}/.well-known/mcp/server-card.json`,
          priority: '0.8',
          changefreq: 'weekly',
        },
        { loc: `${baseUrl}/legal/terms`, priority: '0.6', changefreq: 'monthly' },
        { loc: `${baseUrl}/legal/privacy`, priority: '0.6', changefreq: 'monthly' },
      ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        u =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
      )
      .join('\n') +
    `\n</urlset>\n`;

  return c.body(xml, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

/**
 * RFC 9727 API-catalog linkset. Points crawlers от single well-known path to
 * the authoritative OpenAPI document and its well-known alias. Small,
 * static, content-type application/linkset+json per the RFC.
 */
app.get('/.well-known/api-catalog', c => {
  const host = new URL(c.req.url).host;
  const baseUrl = `https://${host}`;

  const linkset = {
    linkset: [
      {
        anchor: baseUrl,
        'service-desc': [
          {
            href: `${baseUrl}/openapi.json`,
            type: 'application/json',
            title: 'OpenAPI 3.1 specification',
          },
          {
            href: `${baseUrl}/.well-known/mpp-services`,
            type: 'application/json',
            title: 'OpenAPI alias (RFC 8615 well-known)',
          },
        ],
        'service-doc': [
          {
            href: `${baseUrl}/llms.txt`,
            type: 'text/plain',
            title: 'Agent-readable service description',
          },
        ],
        'service-meta': [
          {
            href: `${baseUrl}/.well-known/mcp/server-card.json`,
            type: 'application/json',
            title: 'MCP server manifest',
          },
        ],
      },
    ],
  };

  return c.json(linkset, 200, {
    'content-type': 'application/linkset+json',
    'cache-control': 'public, max-age=3600',
  });
});

/**
 * MCP Server Card. Describes the @mppfy/c2pa-verify-mcp stdio server
 * (see mcp-server/src/index.ts) so MCP-aware hosts (Claude Desktop, Cursor,
 * Continue, Cline) can register the tool without manual JSON hand-editing.
 *
 * `transport: stdio` — the server runs locally via `npx @mppfy/c2pa-verify-mcp`
 * and pays calls through x402 on Base using a user-provided wallet
 * (C2PA_VERIFY_WALLET_PK env). HTTP-transport MCP is a future milestone.
 */
app.get('/.well-known/mcp/server-card.json', c => {
  const card = {
    schemaVersion: '2024-11-05',
    name: 'c2pa-verify',
    title: 'C2PAVerify',
    version: '0.1.0',
    description:
      'MCP server exposing C2PA content-provenance verification as a tool. ' +
      'Agents call `verify_c2pa_manifest(url)` and receive manifest details + ' +
      'trust_chain classification. Each call costs ~$0.01 USDC, paid automatically ' +
      'via x402 on Base mainnet using a user-provided wallet.',
    vendor: {
      name: 'MPPFY',
      url: 'https://mppfy.com',
    },
    homepage: 'https://c2pa.mppfy.com',
    documentation: 'https://github.com/mppfy/C2PAVerify',
    license: 'MIT',
    // Installation — stdio transport launched by the MCP host.
    transport: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@mppfy/c2pa-verify-mcp'],
      env: {
        C2PA_VERIFY_WALLET_PK: {
          description:
            '0x-prefixed EVM private key for a Base mainnet wallet with ≥$0.02 USDC. Required.',
          required: true,
          secret: true,
        },
        C2PA_VERIFY_MAX_ATOMIC: {
          description:
            'Spend cap per call in atomic USDC units. Default 20000 = $0.02.',
          required: false,
          default: '20000',
        },
      },
    },
    // Payment-aware authentication hint — not a standard MCP field yet, но
    // signals к discovery-aware clients что server requires funded wallet.
    authentication: {
      type: 'payment',
      protocols: ['x402'],
      network: 'base',
      asset: 'USDC',
      pricePerCall: '0.01',
      upstream: 'https://c2pa.mppfy.com/verify',
    },
    capabilities: {
      tools: {},
    },
    tools: [
      {
        name: 'verify_c2pa_manifest',
        description:
          'Verify the C2PA content-provenance manifest on a publicly-hosted ' +
          'image/video/audio file. Returns manifest details (claim_generator, ' +
          'signed_by, assertions) and trust_chain classification ' +
          '(valid | partial | unknown). Costs ~$0.01 USDC per call.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'HTTPS URL of the media file to verify.',
            },
          },
          required: ['url'],
        },
      },
    ],
    categories: ['media', 'provenance', 'compliance'],
    keywords: ['c2pa', 'content-credentials', 'deepfake', 'ai-generated', 'x402'],
  };

  return c.json(card, 200, {
    'cache-control': 'public, max-age=3600',
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
