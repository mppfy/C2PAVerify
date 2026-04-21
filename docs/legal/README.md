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

Before going live **with revenue you'd miss**, budget 1 hour with counsel
familiar with `[JURISDICTION]` to review. For MVP traffic (pre-revenue or
< $10K/yr) the current drafts are defensible.

## Placeholders to fill

Search for `[BRACKETED]` tokens in both files. Required fills:

| Placeholder | What to enter | Notes |
|---|---|---|
| `[OPERATOR_ENTITY]` | Legal name of the entity running the service | "Fedor Zubrickij" (individual) or a registered company name |
| `[JURISDICTION]` | Country/state whose law governs the contract | e.g. "Estonia", "Netherlands", "Delaware, USA" — pick the one your entity is registered in |
| `[DISPUTE_VENUE]` | Where disputes are resolved | Usually matches jurisdiction (e.g. "Tallinn, Estonia"). Arbitration optional for MVP. |
| `[CONTACT_EMAIL]` | Single email for legal + privacy inquiries | Suggested: `legal@mppfy.com` (need to wire MX to a real inbox) |
| `[SECURITY_EMAIL]` | For vulnerability disclosure | Suggested: `security@mppfy.com` |
| `[EFFECTIVE_DATE]` | Date this version went live | Format: YYYY-MM-DD. Current drafts use 2026-04-21. |

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
`rules = [{ type = "Text", globs = ["**/*.md"] }]`) and serve with
`Content-Type: text/markdown; charset=utf-8`.

The landing page footer and OpenAPI `info.termsOfService` link to
`/legal/terms`.
