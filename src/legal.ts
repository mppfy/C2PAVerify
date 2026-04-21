// Legal docs served at /legal/terms and /legal/privacy.
//
// Source of truth lives in docs/legal/*.md; wrangler bundles them as text
// modules (see wrangler.toml `[[rules]] type = "Text" globs = ["**/legal/*.md"]`).
// This module re-exports the raw markdown plus small helpers for setting
// cache + content-type headers consistently across routes.
//
// Version + effective-date are parsed from the markdown frontmatter-ish
// header ("Effective date: YYYY-MM-DD" + "Version: X.Y.Z-...") so metadata
// like OpenAPI `info.termsOfService` and Link headers stay in sync with the
// document itself. Single source of truth = the markdown file.

import termsMarkdown from '../docs/legal/terms-of-service.md';
import privacyMarkdown from '../docs/legal/privacy.md';

export interface LegalDocMeta {
  readonly version: string;
  readonly effectiveDate: string; // ISO YYYY-MM-DD
  readonly markdown: string;
}

/**
 * Parse `**Effective date:** YYYY-MM-DD` and `**Version:** X.Y.Z-...` out of
 * the document head. Kept deliberately strict — if either line is missing
 * or malformed we return placeholders so callers see it during review.
 */
function parseMeta(markdown: string): LegalDocMeta {
  const dateMatch = markdown.match(/\*\*Effective date:\*\*\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  const versionMatch = markdown.match(/\*\*Version:\*\*\s*([^\s\n]+)/);
  return {
    markdown,
    effectiveDate: dateMatch?.[1] ?? 'unknown',
    version: versionMatch?.[1] ?? 'unknown',
  };
}

export const TERMS: LegalDocMeta = parseMeta(termsMarkdown);
export const PRIVACY: LegalDocMeta = parseMeta(privacyMarkdown);

/**
 * Build a standard response for a legal document. Content negotiation:
 *   - default                    → text/markdown
 *   - Accept: text/plain         → text/plain (same bytes)
 *   - Accept: text/html          → text/markdown (we don't render HTML; it's
 *                                  a short read and crawlers prefer markdown)
 *
 * Cache: 1 hour at edge, must-revalidate. Legal docs change rarely but when
 * they do we want new clients to pick up within an hour; a long TTL would
 * hide updates from agents that cached aggressively.
 */
export function legalResponse(doc: LegalDocMeta, acceptHeader: string): Response {
  const accept = acceptHeader.toLowerCase();
  const contentType = accept.includes('text/plain')
    ? 'text/plain; charset=utf-8'
    : 'text/markdown; charset=utf-8';

  return new Response(doc.markdown, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600, must-revalidate',
      'x-legal-version': doc.version,
      'x-legal-effective-date': doc.effectiveDate,
    },
  });
}
