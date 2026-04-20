// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

import type { Context } from 'hono';
import type { ServiceEnv, CallMetrics } from './types';

/**
 * Записать метрики вызова.
 * 
 * Пишем в два места:
 * - Analytics Engine: для быстрых агрегаций (dashboards)
 * - D1: для детальных запросов (kill-reviews, debug)
 * 
 * D1 write через waitUntil, чтобы не блокировать response.
 */
export async function recordCall(
  c: Context<{ Bindings: ServiceEnv }>,
  metrics: CallMetrics
): Promise<void> {
  // Analytics Engine — sync, но очень быстро
  try {
    c.env.METRICS.writeDataPoint({
      blobs: [
        metrics.serviceId,
        metrics.status,
        metrics.agentId ?? 'unknown',
      ],
      doubles: [
        metrics.latencyMs,
        metrics.revenueUsd,
        metrics.upstreamCostUsd,
      ],
      indexes: [metrics.serviceId],
    });
  } catch (err) {
    console.error('Failed to write to Analytics Engine:', err);
  }
  
  // D1 — async через waitUntil
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO service_calls 
       (service_id, status, latency_ms, revenue_usd, upstream_cost_usd, agent_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        metrics.serviceId,
        metrics.status,
        metrics.latencyMs,
        metrics.revenueUsd,
        metrics.upstreamCostUsd,
        metrics.agentId ?? null,
        metrics.timestamp
      )
      .run()
      .catch(err => console.error('D1 write failed:', err))
  );
}

/**
 * Обертка для handler'а сервиса.
 * Измеряет latency, логирует результат, ловит ошибки.
 */
export async function wrapHandler(
  c: Context<{ Bindings: ServiceEnv }>,
  serviceId: string,
  priceUsd: number,
  upstreamCostUsd: number,
  handler: () => Promise<Response>
): Promise<Response> {
  const start = Date.now();
  const agentId = c.req.header('x-agent-id') ?? undefined;
  
  try {
    const response = await handler();
    const isUnpaid = response.status === 402;
    const isError = response.status >= 500;
    
    await recordCall(c, {
      serviceId,
      status: isUnpaid ? 'unpaid' : isError ? 'error' : 'success',
      latencyMs: Date.now() - start,
      revenueUsd: isUnpaid || isError ? 0 : priceUsd,
      upstreamCostUsd: isUnpaid || isError ? 0 : upstreamCostUsd,
      agentId,
      timestamp: Date.now(),
    });
    
    return response;
  } catch (err) {
    console.error(`Service ${serviceId} handler threw:`, err);
    
    await recordCall(c, {
      serviceId,
      status: 'error',
      latencyMs: Date.now() - start,
      revenueUsd: 0,
      upstreamCostUsd: 0,
      agentId,
      timestamp: Date.now(),
    });
    
    return new Response(
      JSON.stringify({ error: 'internal server error' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
