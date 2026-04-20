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
  X402_FACILITATOR_URL?: string; // Defaults to https://x402.org/facilitator
  X402_ASSET_ADDRESS?: string; // USDC contract — defaults per network
  DEFAULT_PROTOCOL?: 'mpp' | 'x402'; // Fallback when client sends no hints (default: 'mpp' during shadow rollout)

  // Global config
  ENVIRONMENT: 'development' | 'staging' | 'production';
  PAYMENT_MODE: 'dev' | 'mpp' | 'x402' | 'multi'; // Controls which adapter(s) active
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
