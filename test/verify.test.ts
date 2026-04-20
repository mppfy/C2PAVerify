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

  it('blocks AWS metadata URL via SSRF guard (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://169.254.169.254/latest/meta-data/' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/blocked/);
  });

  it('blocks private IP 10.0.0.1 (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://10.0.0.1/asset.jpg' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks localhost hostname (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://localhost/asset.jpg' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks http:// scheme (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com/asset.jpg' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks file:// scheme (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks .internal TLD (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://service.internal/asset.jpg' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks IPv6 loopback (403)', async () => {
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://[::1]/asset.jpg' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /verify — security hardening', () => {
  it('rejects oversized Content-Length without parsing body (413)', async () => {
    // Fake large Content-Length — server should reject before reading body.
    // We send a small body but lie about its size.
    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=X',
        'content-length': String(50 * 1024 * 1024), // 50MB > 25MB cap
      },
      body: '--X--', // tiny actual body — precheck should fire first
    });
    expect(res.status).toBe(413);
  });

  it('rejects Content-Type/magic-bytes mismatch with 415', async () => {
    // Upload random bytes but claim Content-Type: image/jpeg
    const fakeJpeg = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const form = new FormData();
    form.append('file', new Blob([fakeJpeg], { type: 'image/jpeg' }), 'fake.jpg');

    const res = await SELF.fetch('https://test.mppfy.com/verify', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('format_mismatch');
  });

  it('does not leak raw_manifest_store in successful response', async () => {
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
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.raw_manifest_store).toBeUndefined();
  });

  it('warnings contain stable codes only (no raw explanation)', async () => {
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
    const body = (await res.json()) as { warnings?: string[] };
    expect(Array.isArray(body.warnings)).toBe(true);
    // Every warning должен matchать stable c2pa-rs validation code pattern
    // (e.g. "signingCredential.untrusted", "claimSignature.validated").
    for (const w of body.warnings ?? []) {
      expect(w).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z][a-zA-Z0-9_]*/);
    }
  });

  it('applies rate limit and returns 429 after threshold', async () => {
    // Hit endpoint with minimal body many times — once over limit → 429 with
    // Retry-After + x-ratelimit-* headers.
    // NOTE: каждый test runs в свежем miniflare isolate (KV reset), но в рамках
    // этого теста rate-limit counter накопится → последний запрос блокируется.
    // Отправляем невалидный body (415) чтобы быстро получить response, не тратя
    // CPU на c2pa verification.
    const fakeBytes = new Uint8Array([0x00, 0x01, 0x02]);
    const limit = 30; // matches RATE_LIMIT_PER_MIN в service.ts
    let hitLimit = false;

    for (let i = 0; i < limit + 2; i++) {
      const form = new FormData();
      form.append('file', new Blob([fakeBytes], { type: 'image/jpeg' }), 'x.jpg');
      const res = await SELF.fetch('https://rl.test.mppfy.com/verify', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '192.0.2.99' }, // test-reserved IP, consistent bucket
        body: form,
      });
      if (res.status === 429) {
        expect(res.headers.get('retry-after')).toBeTruthy();
        expect(res.headers.get('x-ratelimit-limit')).toBe(String(limit));
        expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
        hitLimit = true;
        break;
      }
    }

    expect(hitLimit).toBe(true);
  });

  it('assertion payloads are stripped (only labels remain)', async () => {
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
    const body = (await res.json()) as {
      manifest?: { assertions?: Array<Record<string, unknown>> };
    };
    const assertions = body.manifest?.assertions ?? [];
    expect(assertions.length).toBeGreaterThan(0);
    // Each assertion object should have ONLY `label` key.
    for (const a of assertions) {
      expect(Object.keys(a)).toEqual(['label']);
    }
  });
});
