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

async function handler(
  c: Context<{ Bindings: ServiceEnv }>,
): Promise<Response> {
  const contentType = c.req.header('content-type') ?? '';

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

    // URL path deferred: requires SSRF protection (W2.5 после security-reviewer)
    return c.json(
      {
        error: 'not_implemented',
        reason:
          'URL fetch is pending SSRF protection. Use multipart file upload instead.',
        eta: 'W2.5',
      },
      501,
    );
  }

  // ─── multipart/form-data path ──────────────────────────────
  if (contentType.includes('multipart/form-data')) {
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

    // Size cap — 25MB default (larger than typical signed image/video, smaller than Worker memory limit)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (fileField.size > MAX_SIZE) {
      return c.json(
        {
          error: 'file_too_large',
          reason: `File exceeds ${MAX_SIZE} bytes (actual: ${fileField.size})`,
        },
        413,
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
