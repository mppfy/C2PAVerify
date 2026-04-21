# Legal docs for c2pa-verify

This directory contains the Terms of Service and Privacy Policy served at:

- `https://c2pa.mppfy.com/legal/terms`
- `https://c2pa.mppfy.com/legal/privacy`

## MVP posture

These are **MVP drafts** — "good enough to host publicly and shield against the
80% of legal liability, not big-co-grade." Built from:

- **Skeleton**: [Common Paper Standard ToS](https://commonpaper.com/standards/terms-of-service/) (CC BY 4.0)
- **AUP / rate-limit / AS-IS language**: modeled after [Google APIs ToS](https://developers.google.com/terms/)
- **Crypto irreversibility**: modeled after [Uniswap Labs ToS](https://support.uniswap.org/hc/en-us/articles/30935100859661-Uniswap-Labs-Terms-of-Service) + [Consensys](https://consensys.io/terms-of-use)
- **C2PA-specific carve-outs**: our own (manifest integrity ≠ truth of content)

Before going live **with revenue you'd miss**, budget 1 hour with Wyoming
counsel to review. For MVP traffic (pre-revenue or < $10K/yr) the current
drafts are defensible.

## Filled values (v1.0.0)

All placeholders have been filled as of 2026-04-21. Record of what went where:

| Field | Value | Rationale |
|---|---|---|
| Operator entity | **TheLuxArmor LLC**, a Wyoming limited liability company | Registered US entity. Matches governing law. |
| Governing law | **State of Wyoming, USA** | Entity home state. Wyoming LLC statute (Title 17, Chapter 29) offers strong charging-order protection and no state income tax. |
| Dispute venue | **the state and federal courts located in Laramie County, Wyoming** | Laramie County (Cheyenne) is Wyoming's state capital and seat of the US District Court for the District of Wyoming + Wyoming Supreme Court. Safe statewide default; adjust if the registered agent sits in a different county (e.g. Sheridan, Natrona). |
| Legal / privacy contact | **legal@mppfy.com** | Single inbox for contract questions, DSARs, and privacy inquiries. MX must be wired to a real mailbox before going live with revenue. |
| Security disclosure | **security@mppfy.com** | Follows [RFC 9116 /.well-known/security.txt](https://www.rfc-editor.org/rfc/rfc9116) convention. Separate from legal@ so vuln reports don't mix with contract disputes. |
| Effective date | **2026-04-21** | First version where all blanks were filled. |

If any of the above change (e.g. a new operator entity, relocation), bump
version + effective date and add a change-log entry inside the markdown
document itself.

## Versioning

Any **substantive** change (liability, payment terms, scope) requires:

1. Bump `effective_date` at top of document.
2. Commit with `docs(legal): ...` prefix.
3. Update `info.termsOfService` version in `src/index.ts` if URL changes.
4. Announce on landing page banner for 7 days (optional for MVP).

Typo / formatting changes don't need version bump.

## Serving

`src/index.ts` exposes `GET /legal/terms` and `GET /legal/privacy`. They read
these markdown files at build time (embedded as text modules via wrangler
`[[rules]] type = "Text" globs = ["**/legal/*.md"]` — scoped so unrelated
READMEs stay out of the bundle) and serve with `Content-Type: text/markdown;
charset=utf-8`. Version + effective date are parsed from the `**Version:**`
and `**Effective date:**` markdown header lines and exposed as `X-Legal-Version`
and `X-Legal-Effective-Date` response headers.

The landing page footer and OpenAPI `info.termsOfService` link to
`/legal/terms`.
