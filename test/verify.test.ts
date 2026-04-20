/**
 * W2 TDD — первая failing spec для /verify.
 *
 * Premise: test fixture `adobe-signed.jpg` — реальный signed JPEG из c2pa-rs suite
 * (163 KB, Adobe intermediate CA). Это RED test для c2pa-wasm integration.
 *
 * Как ожидается пройти GREEN: handler принимает multipart upload, прогоняет через
 * WasmReader.fromBlob, возвращает structured JSON.
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  adobeSignedJpegBytes,
  adobeSignedJpegMime,
} from './fixtures/adobe-signed';

describe('POST /verify — C2PA extraction (multipart)', () => {
  it('accepts signed JPEG upload and returns 200 with manifest', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([adobeSignedJpegBytes], { type: adobeSignedJpegMime }),
      'adobe-signed.jpg',
    );

    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      verified: boolean;
      manifest?: {
        claim_generator?: string;
        assertions?: Array<{ label: string }>;
      };
      warnings?: string[];
    };

    // Must surface that this asset has a manifest embedded
    expect(body.verified).toBe(true);
    expect(body.manifest).toBeDefined();
    expect(body.manifest?.claim_generator).toBeTruthy();
    expect(Array.isArray(body.manifest?.assertions)).toBe(true);
    expect(body.manifest?.assertions?.length).toBeGreaterThan(0);
  });

  it('returns 422 with structured error when file has no C2PA manifest', async () => {
    // 1x1 transparent PNG — valid image, zero C2PA
    const blankPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const form = new FormData();
    form.append(
      'file',
      new Blob([blankPng], { type: 'image/png' }),
      'blank.png',
    );

    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toMatch(/no[- _]c2pa/i);
  });
});

describe('POST /verify — input validation', () => {
  it('rejects request with no body with 400', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects URL body in dev mode until SSRF protection lands', async () => {
    // URL path не реализован в W2 — returns 501 or 400.
    // Когда URL path будет добавлен + SSRF guard, этот тест поменяется.
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/meta' }),
    });
    expect([400, 403, 501]).toContain(res.status);
  });
});
