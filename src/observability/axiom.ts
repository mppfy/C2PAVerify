/**
 * Axiom logs ingest — zero-deps HTTP POST.
 *
 * Endpoint: https://api.axiom.co/v1/datasets/<dataset>/ingest
 * Auth: `Authorization: Bearer <ingest-token>`
 * Body: NDJSON or JSON array of events.
 *
 * Usage:
 *   sendLog(env, executionCtx, {
 *     level: 'info',
 *     service: 'c2pa-verify',
 *     event: 'verify_call',
 *     latency_ms: 123,
 *     status: 200,
 *   });
 *
 * Если AXIOM_TOKEN не задан — no-op (safe в dev / до signup).
 * Fire-and-forget через waitUntil — не блокирует response.
 *
 * BetterStack logs совместимы с этим же HTTP-source shape'ом; при желании
 * поменять target — переопределить AXIOM_* на BETTERSTACK_* через
 * `env.AXIOM_ENDPOINT_URL` override (добавить если потребуется).
 */

import type { ExecutionContext } from 'hono';
import type { ServiceEnv } from '../_vendor/core/types';

export interface LogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  event: string;
  /** ISO 8601 timestamp; defaults to now. */
  _time?: string;
  [key: string]: unknown;
}

/**
 * Ship one log event. Fire-and-forget.
 *
 * Если понадобится батчинг — добавить LogBuffer + ctx.waitUntil(buffer.flush)
 * в onError/beforeResponse hook. Сейчас per-event POST приемлем (launch traffic
 * мал + Axiom ingest rate limit высокий).
 */
export function sendLog(
  env: ServiceEnv,
  executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined,
  event: LogEvent,
): void {
  const token = env.AXIOM_TOKEN;
  if (!token) return;

  const dataset = env.AXIOM_DATASET ?? 'c2pa-verify';
  const url = `https://api.axiom.co/v1/datasets/${encodeURIComponent(dataset)}/ingest`;

  const payload = [
    {
      _time: event._time ?? new Date().toISOString(),
      environment: env.ENVIRONMENT,
      ...event,
    },
  ];

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (env.AXIOM_ORG_ID) {
    headers['x-axiom-org-id'] = env.AXIOM_ORG_ID;
  }

  const send = fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
    .then(r => {
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error(`[axiom] ingest failed ${r.status}`);
      }
      return r;
    })
    .catch(e => {
      // Never let logging itself crash.
      // eslint-disable-next-line no-console
      console.error('[axiom] send error:', e);
      return null;
    });

  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(send);
  }
}
