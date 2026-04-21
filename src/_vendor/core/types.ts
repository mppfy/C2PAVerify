// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

import type { Context } from 'hono';

/**
 * Биндинги Cloudflare Worker'а (из wrangler.toml).
 */
export interface ServiceEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  METRICS: AnalyticsEngineDataset;
  
  // MPP config
  TEMPO_WALLET_PRIVATE_KEY: string;
  MPP_RECIPIENT_ADDRESS: string;
  MPP_SECRET_KEY: string;
  
  // x402 config
  X402_ENABLED?: string; // "true" | "false" — feature flag for dark launch
  X402_RECIPIENT_ADDRESS?: string; // 0x... Base EOA (chain-agnostic, may equal MPP_RECIPIENT_ADDRESS)
  X402_NETWORK?: 'base' | 'base-sepolia'; // Defaults to base-sepolia in staging, base in production
  X402_FACILITATOR_URL?: string; // Single-primary mode (legacy). Use X402_FACILITATOR_URLS for pool mode.
  X402_FACILITATOR_URLS?: string; // Pool mode — comma-separated list of primary facilitators. Round-robin routed across primaries with sticky verify↔settle pinning. Each URL can have "|label" suffix: "https://facilitator.payai.network|payai,https://api.cdp.coinbase.com/platform/v2/x402|cdp". Labels default to host if omitted.
  X402_CDP_API_KEY_ID?: string;   // secret — CDP API key ID for signed JWT auth on CDP facilitator URL
  X402_CDP_API_KEY_SECRET?: string; // secret — CDP API key secret (PEM EC or base64 Ed25519) — see @coinbase/cdp-sdk auth docs
  X402_ASSET_ADDRESS?: string; // USDC contract — defaults per network
  X402_SEED_PAYERS?: string; // Comma-separated 0x... payer addresses whose payments are tagged `source=seed` in observability (excluded from organic-demand metrics). Empty = all traffic organic.
  DEFAULT_PROTOCOL?: 'mpp' | 'x402'; // Fallback when client sends no hints (default: 'mpp' during shadow rollout)

  // Global config
  ENVIRONMENT: 'development' | 'staging' | 'production';
  PAYMENT_MODE: 'dev' | 'mpp' | 'x402' | 'multi'; // Controls which adapter(s) active

  // Observability — все optional, если DSN/token не задан, модуль no-op'ит.
  SENTRY_DSN?: string;           // https://<key>@<host>/<project> — errors → Sentry
  SENTRY_RELEASE?: string;       // git sha, populated by CI
  AXIOM_TOKEN?: string;          // Bearer ingest token (Axiom api.axiom.co)
  AXIOM_DATASET?: string;        // target dataset name (default: c2pa-verify)
  AXIOM_ORG_ID?: string;         // optional — omits header if unset

  // Facilitator resilience — см. src/_vendor/adapters/x402-facilitator.ts
  X402_FACILITATOR_FALLBACK_URL?: string; // fallback если primary timeouts
  X402_FACILITATOR_TIMEOUT_MS?: string;   // строка (env vars), parse в runtime. default 5000
}

export type ServiceStatus = 'active' | 'deprecated' | 'disabled';

export interface ServicePrice {
  amount: string;           // "0.002"
  currency: 'USDC';         // в будущем расширяем
}

/**
 * Контракт для определения MPP-сервиса.
 * Используется через defineService() factory.
 * 
 * Сервис protocol-agnostic — handler не знает ничего о payment.
 */
export interface ServiceDefinition {
  /** Уникальный ID, используется в URL: /svc/:id */
  id: string;
  
  /** Человекочитаемое имя для каталога */
  name: string;
  
  /** Описание для агентов и LLM — критично для discovery */
  description: string;
  
  /** Категории для фильтрации в каталоге */
  categories: string[];
  
  /** Цена за вызов */
  price: ServicePrice;
  
  /** Статус — активно/заморожено/убито */
  status: ServiceStatus;
  
  /** Примерная стоимость upstream API (для маржи) */
  upstreamCost?: number;
  
  /** Реализация — protocol-agnostic, только business logic */
  handler: (c: Context<{ Bindings: ServiceEnv }>) => Promise<Response>;
}

/**
 * Метрики вызова, пишутся в Analytics Engine + D1.
 */
export interface CallMetrics {
  serviceId: string;
  status: 'success' | 'error' | 'unpaid';
  latencyMs: number;
  revenueUsd: number;
  upstreamCostUsd: number;
  agentId?: string;
  protocol?: string; // 'mpp' | 'x402' | 'none'
  timestamp: number;
}
