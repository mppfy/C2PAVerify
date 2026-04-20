/**
 * C2PAVerify service definition.
 *
 * ⚠️ W1 SCAFFOLD — handler returns a placeholder response.
 * Real implementation arrives W2 (2026-04-27 → 05-03):
 *   - parse C2PA manifest from URL or uploaded file
 *   - validate signature chain against CAI trust list
 *   - return structured verification result (see README.md for schema)
 *
 * Library candidates: c2pa-node (OSS), @contentauth/sdk-js, c2patool CLI wrapper.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { ServiceDefinition, ServiceEnv } from './_vendor/core/types';
import { defineService } from './_vendor/core/define-service';

const VerifyRequestSchema = z.object({
  url: z.string().url().optional(),
  // multipart file uploads validated separately via c.req.parseBody()
});

async function handler(
  c: Context<{ Bindings: ServiceEnv }>,
): Promise<Response> {
  const contentType = c.req.header('content-type') ?? '';

  // Accept JSON with URL or multipart upload
  if (contentType.includes('application/json')) {
    const body = await c.req.json().catch(() => null);
    const parsed = VerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_request',
          issues: parsed.error.issues,
        },
        400,
      );
    }
    return c.json({
      scaffold: true,
      message: 'W1 scaffold — verification not yet implemented',
      received: { url: parsed.data.url },
      eta: 'W2 (2026-04-27 → 2026-05-03)',
    });
  }

  if (contentType.includes('multipart/form-data')) {
    return c.json({
      scaffold: true,
      message: 'W1 scaffold — multipart upload not yet implemented',
      eta: 'W2 (2026-04-27 → 2026-05-03)',
    });
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
