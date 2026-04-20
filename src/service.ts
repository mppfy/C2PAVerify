/**
 * C2PAVerify service — W2 implementation.
 *
 * Pipeline:
 *   1. Parse body:
 *        - multipart/form-data → extract 'file' → Blob
 *        - application/json { url } → NOT YET IMPLEMENTED (501) — SSRF guard pending (W2.5)
 *        - empty/invalid → 400
 *   2. verifyC2PA(blob) → discriminated result (ok | error+status)
 *   3. Shape JSON per README schema.
 *
 * URL path deliberately returns 501 в W2 — реализация требует SSRF guard
 * (блокировать private ranges 10/8, 172.16/12, 192.168/16, 169.254/16,
 *  localhost, link-local), size cap, timeout. Делается в security-reviewer pass.
 */

import type { Context } from 'hono';
import type { ServiceDefinition, ServiceEnv } from './_vendor/core/types';
import { defineService } from './_vendor/core/define-service';
import { verifyC2PA } from './c2pa/verify';
import { validateMagicBytes } from './c2pa/magic-bytes';
import {
  checkRateLimit,
  clientKeyFromRequest,
  rateLimitHeaders,
} from './rate-limit';
import { fetchRemoteAsset } from './ssrf-guard';

// Size cap — 25MB. Header precheck (Content-Length) prevents spending memory
// parsing oversized FormData bodies; field-level size check после parse это
// defence-in-depth на случай chunked/streaming upload без Content-Length.
const MAX_SIZE = 25 * 1024 * 1024;

// Rate limit — 30 req/min/IP для /verify. Conservative для launch; tune когда
// пойдёт real traffic. MPP paywall впереди защищает revenue, но этот guard
// предотвращает DoS через repeated 402 challenges.
const RATE_LIMIT_PER_MIN = 30;

async function handler(
  c: Context<{ Bindings: ServiceEnv }>,
): Promise<Response> {
  const contentType = c.req.header('content-type') ?? '';

  // ─── Rate limit (first gate, cheap) ────────────────────────
  const clientKey = clientKeyFromRequest(c.req.raw);
  const rl = await checkRateLimit(c.env.CACHE, clientKey, {
    limit: RATE_LIMIT_PER_MIN,
    windowSeconds: 60,
    namespace: 'c2pa:v',
  });
  if (!rl.allowed) {
    return c.json(
      {
        error: 'rate_limit_exceeded',
        reason: `Too many requests. Limit ${rl.limit}/min per client. Resets at ${new Date(rl.resetAt).toISOString()}.`,
      },
      429,
      {
        ...rateLimitHeaders(rl),
        'retry-after': String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
      },
    );
  }

  // ─── JSON body path ────────────────────────────────────────
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'invalid_json', reason: 'Request body is not valid JSON' },
        400,
      );
    }

    if (!body || typeof body !== 'object') {
      return c.json(
        { error: 'invalid_request', reason: 'Body must be a JSON object' },
        400,
      );
    }

    const { url } = body as { url?: unknown };

    // Empty body: no url, no file — 400
    if (url === undefined) {
      return c.json(
        {
          error: 'missing_input',
          reason: 'Provide either { url } (JSON) or multipart file upload',
        },
        400,
      );
    }

    if (typeof url !== 'string') {
      return c.json(
        { error: 'invalid_url', reason: 'url must be a string' },
        400,
      );
    }

    // URL path with SSRF protection
    const fetchResult = await fetchRemoteAsset(url, MAX_SIZE);
    if (!fetchResult.ok) {
      return c.json(
        { error: fetchResult.error, reason: fetchResult.reason },
        fetchResult.status,
      );
    }

    // Magic-bytes validation на fetched body vs upstream Content-Type
    const fetchedBlob = new Blob([fetchResult.bytes], {
      type: fetchResult.contentType,
    });
    if (
      fetchResult.contentType &&
      !(await validateMagicBytes(fetchedBlob, fetchResult.contentType))
    ) {
      return c.json(
        {
          error: 'format_mismatch',
          reason: `Upstream body does not match Content-Type: ${fetchResult.contentType}`,
        },
        415,
      );
    }

    const outcome = await verifyC2PA(fetchedBlob);
    if (!outcome.ok) {
      return c.json(outcome.error, outcome.status);
    }
    return c.json(outcome.result);
  }

  // ─── multipart/form-data path ──────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    // ① Content-Length precheck — дешёвый reject ДО parsing FormData (which
    //    would buffer entire body into memory). Allow a small multipart envelope
    //    overhead beyond the file itself.
    const declaredLength = Number(c.req.header('content-length') ?? '0');
    if (declaredLength > 0 && declaredLength > MAX_SIZE + 64 * 1024) {
      return c.json(
        {
          error: 'file_too_large',
          reason: `Request exceeds ${MAX_SIZE} bytes (declared: ${declaredLength})`,
        },
        413,
      );
    }

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      return c.json(
        { error: 'invalid_multipart', reason: 'Could not parse multipart body' },
        400,
      );
    }

    const fileField = form.get('file') as Blob | string | null;
    if (!fileField || typeof fileField === 'string') {
      return c.json(
        {
          error: 'missing_file',
          reason: 'Multipart body must include a "file" field',
        },
        400,
      );
    }

    // ② Defence-in-depth size check post-parse (covers chunked uploads без CL).
    if (fileField.size > MAX_SIZE) {
      return c.json(
        {
          error: 'file_too_large',
          reason: `File exceeds ${MAX_SIZE} bytes (actual: ${fileField.size})`,
        },
        413,
      );
    }

    // ③ Magic-bytes validation — reject polyglot / spoofed Content-Type.
    //    Client-controlled Content-Type поле не trust'ится as-is.
    const declaredFormat = (fileField.type || '').split(';')[0]!.trim().toLowerCase();
    if (declaredFormat && !(await validateMagicBytes(fileField, declaredFormat))) {
      return c.json(
        {
          error: 'format_mismatch',
          reason: `File contents do not match declared Content-Type: ${declaredFormat}`,
        },
        415,
      );
    }

    const outcome = await verifyC2PA(fileField);
    if (!outcome.ok) {
      return c.json(outcome.error, outcome.status);
    }
    return c.json(outcome.result);
  }

  return c.json(
    {
      error: 'unsupported_content_type',
      expected: ['application/json', 'multipart/form-data'],
      received: contentType,
    },
    415,
  );
}

export const c2paVerify: ServiceDefinition = defineService({
  id: 'c2pa-verify',
  name: 'C2PAVerify',
  description:
    'Verify C2PA (Content Provenance and Authenticity) manifests on images and media. ' +
    'Extracts embedded manifest, validates signature chain against CAI trust list, ' +
    'returns structured provenance report.',
  categories: ['media', 'provenance', 'compliance'],
  price: { amount: '0.01', currency: 'USDC' },
  status: 'active',
  upstreamCost: 0,
  handler,
});
