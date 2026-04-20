/**
 * Minimal Sentry client for Cloudflare Workers — zero deps, no SDK.
 *
 * Посылает ошибки через Sentry Envelope API напрямую. Избегаем `@sentry/*`
 * пакетов чтобы не добавлять ~200 KB к бандлу и не воевать с workerd
 * incompat'ами (они local/filesystem hooks активно делают).
 *
 * DSN format: https://<PUBLIC_KEY>@<host>.ingest.sentry.io/<PROJECT_ID>
 *   POST https://<host>/api/<PROJECT_ID>/envelope/
 *   Header: `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<PUBLIC_KEY>, sentry_client=mppfy-worker/0.1`
 *
 * waitUntil() используется, чтобы не блокировать response. Если DSN не задан
 * — captureException no-op'ит (safe to call из любого кода).
 */

import type { ExecutionContext } from 'hono';

export interface SentryContext {
  dsn: string | undefined;
  release: string | undefined;
  environment: string;
  executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
  /** Request being handled — extracted into Sentry event context. */
  request?: Request;
  /** Stable deployment tag, e.g. "c2pa-verify@production". */
  serverName?: string;
}

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    // pathname starts with /; projectId = last non-empty segment
    const parts = u.pathname.split('/').filter(Boolean);
    const projectId = parts[parts.length - 1];
    if (!publicKey || !projectId) return null;
    const host = u.host;
    return {
      envelopeUrl: `https://${host}/api/${projectId}/envelope/`,
      publicKey,
      projectId,
    };
  } catch {
    return null;
  }
}

/** Sentry-spec envelope = header JSON \n item-header JSON \n item-payload JSON. */
function buildEnvelope(
  eventId: string,
  sentAt: string,
  eventBody: Record<string, unknown>,
): string {
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: sentAt,
    sdk: { name: 'mppfy-worker', version: '0.1.0' },
  });
  const itemHeader = JSON.stringify({ type: 'event' });
  const itemPayload = JSON.stringify(eventBody);
  return `${envelopeHeader}\n${itemHeader}\n${itemPayload}\n`;
}

function randomHexId(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Capture an exception. Fire-and-forget — returns the event id so callers
 * can log `{ sentry_id }` alongside the user-facing 500 for cross-reference.
 * If DSN missing or send fails, returns null.
 */
export function captureException(
  err: unknown,
  ctx: SentryContext,
  extra?: Record<string, unknown>,
): string | null {
  if (!ctx.dsn) return null;
  const parsed = parseDsn(ctx.dsn);
  if (!parsed) return null;

  const eventId = randomHexId(16);
  const sentAt = new Date().toISOString();

  const error = err instanceof Error ? err : new Error(String(err));
  const stackFrames = (error.stack ?? '')
    .split('\n')
    .slice(1, 50) // skip message line, cap at 50 frames
    .map(line => ({ filename: line.trim() }));

  const requestContext = ctx.request
    ? {
        url: ctx.request.url,
        method: ctx.request.method,
        headers: Object.fromEntries(
          [...ctx.request.headers.entries()].filter(
            ([k]) =>
              // Scrub Authorization/Cookie/x-payment headers — payloads могут
              // содержать signed payments, не надо их в Sentry.
              !/^(authorization|cookie|x-payment|x-api-key)$/i.test(k),
          ),
        ),
      }
    : undefined;

  const event: Record<string, unknown> = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    server_name: ctx.serverName ?? 'c2pa-verify',
    environment: ctx.environment,
    ...(ctx.release ? { release: ctx.release } : {}),
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: { frames: stackFrames.reverse() }, // Sentry wants outer→inner
        },
      ],
    },
    ...(requestContext ? { request: requestContext } : {}),
    ...(extra ? { extra } : {}),
  };

  const body = buildEnvelope(eventId, sentAt, event);
  const authHeader =
    `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=mppfy-worker/0.1.0`;

  const send = fetch(parsed.envelopeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-sentry-envelope',
      'x-sentry-auth': authHeader,
    },
    body,
  })
    .then(r => {
      if (!r.ok) {
        console.error(`[sentry] ingest failed ${r.status}`);
      }
      return r;
    })
    .catch(e => {
      // Never let Sentry reporting itself crash the Worker.
      console.error('[sentry] send error:', e);
      return null;
    });

  // Use waitUntil если доступен — не блокируем response.
  if (ctx.executionCtx && typeof ctx.executionCtx.waitUntil === 'function') {
    ctx.executionCtx.waitUntil(send);
  }

  return eventId;
}
