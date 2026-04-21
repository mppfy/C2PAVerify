/**
 * Legal endpoint contract tests.
 *
 * The /legal/terms and /legal/privacy endpoints serve the raw markdown from
 * docs/legal/ bundled as text modules. Tests lock in:
 *
 * 1. 200 OK + text/markdown by default
 * 2. text/plain when client asks via Accept header
 * 3. Version + effective-date propagate from markdown frontmatter
 *    into X-Legal-* response headers (so caches + aggregators can
 *    detect changes without diffing content)
 * 4. Critical carve-out clauses are present — if someone accidentally
 *    deletes the "manifest integrity ≠ truth of content" disclaimer
 *    while editing the ToS, we block it here
 * 5. Discovery surfaces (OpenAPI info.termsOfService, Link header on
 *    `/`, sitemap) reference the legal URLs so agents find them
 */

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * Strip markdown emphasis (**bold**, *italic*, __u__, _u_) + collapse
 * whitespace so semantic regression guards match the PROSE, not the
 * byte-for-byte markdown formatting. "does **not** verify" must match
 * `does not verify` — the asterisks are presentation, not content.
 */
function plain(md: string): string {
  return md
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/\*/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

describe('GET /legal/terms', () => {
  it('returns 200 + text/markdown by default', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/legal/terms');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
  });

  it('returns text/plain when Accept: text/plain is sent', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/legal/terms', {
      headers: { accept: 'text/plain' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
  });

  it('exposes version + effective-date in X-Legal-* headers', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/legal/terms');
    expect(res.headers.get('x-legal-version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.headers.get('x-legal-effective-date')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('is cacheable with must-revalidate (so updates propagate hourly)', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/legal/terms');
    const cache = res.headers.get('cache-control') ?? '';
    expect(cache).toContain('max-age=3600');
    expect(cache).toContain('must-revalidate');
  });

  describe('required carve-out clauses (regression guards)', () => {
    it('contains "manifest integrity ≠ truth of content" warning', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/terms',
      );
      const md = plain(await res.text());
      // THE critical disclaimer — deletion = legal liability for depicted
      // content truth. Exact phrasing may evolve; check semantic anchors.
      expect(md).toContain('does not verify');
      expect(md).toMatch(/truth|authenticity|deepfake/);
    });

    it('contains crypto-irreversibility clause', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/terms',
      );
      const md = plain(await res.text());
      expect(md).toContain('irreversible');
      expect(md).toMatch(/refund|non-recoverable|cannot be reversed/);
    });

    it('contains AS-IS disclaimer + liability cap', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/terms',
      );
      const md = plain(await res.text());
      expect(md).toContain('as is');
      expect(md).toMatch(/limitation of liability|liability.*cap/);
    });

    it('contains sanctions + export-control clause', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/terms',
      );
      const md = plain(await res.text());
      expect(md).toMatch(/sanctions|ofac|export control/);
    });
  });
});

describe('GET /legal/privacy', () => {
  it('returns 200 + text/markdown by default', async () => {
    const res = await SELF.fetch(
      'https://c2pa-staging.mppfy.com/legal/privacy',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
  });

  it('exposes version + effective-date headers', async () => {
    const res = await SELF.fetch(
      'https://c2pa-staging.mppfy.com/legal/privacy',
    );
    expect(res.headers.get('x-legal-version')).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.headers.get('x-legal-effective-date')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  describe('required clauses (regression guards)', () => {
    it('states "no file content storage" explicitly', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/privacy',
      );
      const md = await res.text();
      expect(md.toLowerCase()).toMatch(
        /do not store|no storage|not retain|discarded/,
      );
    });

    it('lists third-party processors (Cloudflare + Axiom + facilitators)', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/privacy',
      );
      const md = await res.text();
      expect(md).toContain('Cloudflare');
      expect(md).toContain('Axiom');
      expect(md.toLowerCase()).toMatch(/payai|coinbase|cdp|facilitator/);
    });

    it('documents retention period', async () => {
      const res = await SELF.fetch(
        'https://c2pa-staging.mppfy.com/legal/privacy',
      );
      const md = await res.text();
      expect(md).toMatch(/\d+\s*days/i);
    });
  });
});

describe('Discovery surface references legal docs', () => {
  it('OpenAPI info.termsOfService points at /legal/terms', async () => {
    const res = await SELF.fetch(
      'https://c2pa-staging.mppfy.com/openapi.json',
    );
    const body = (await res.json()) as {
      info: { termsOfService?: string };
      paths: Record<string, unknown>;
    };
    expect(body.info.termsOfService).toBe(
      'https://c2pa-staging.mppfy.com/legal/terms',
    );
    expect(body.paths['/legal/terms']).toBeDefined();
    expect(body.paths['/legal/privacy']).toBeDefined();
  });

  it('Link header on GET / includes rel="terms-of-service" + rel="privacy-policy"', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/');
    const link = res.headers.get('link') ?? '';
    expect(link).toContain('rel="terms-of-service"');
    expect(link).toContain('rel="privacy-policy"');
    expect(link).toContain('</legal/terms>');
    expect(link).toContain('</legal/privacy>');
  });

  it('sitemap.xml lists legal URLs', async () => {
    const res = await SELF.fetch('https://c2pa-staging.mppfy.com/sitemap.xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>https://c2pa-staging.mppfy.com/legal/terms</loc>');
    expect(xml).toContain(
      '<loc>https://c2pa-staging.mppfy.com/legal/privacy</loc>',
    );
  });
});
