# `/v1/decide` — v2 Roadmap Spec

> **⚠️ SUPERSEDED 2026-04-20 by [`v2-multi-signal-authenticity.md`](./v2-multi-signal-authenticity.md) per [ADR-003](../../mpp-project/architecture/adr-003-m6-multi-signal-pivot.md).**
>
> **Why superseded:** C2PA-only policy layer не решает 95%-coverage gap (most web content без C2PA credentials → verdict `warn/reject` без actionable signal). Replaced by multi-signal authenticity engine (C2PA + EXIF + known-tool + perceptual hash).
>
> This document retained **for historical context only**. Do not implement.

---

**Status:** Planning only. Not scheduled. Blocked on traffic signal from current `POST /verify` (M6).

**Trigger to build:** `POST /verify` >= 100 requests/day sustained over 14 days, OR 3+ customer interviews requesting policy verdict output.

**Estimated effort:** ~2 weeks for MVP scope below; ~6 weeks for full spec.

---

## Positioning shift

Current product (M6, shipped):
> "Verify C2PA manifest. Return structured manifest data + trust_chain status."

Future product (v2):
> "Give agent a URL → get action-ready decision verdict (`allow` / `warn` / `needs_human_review` / `reject`) with reason code."

Value delta: normalization layer + trust classification + policy verdict — not raw validation.

---

## MVP scope (~2 weeks)

Ship exactly this. Nothing more.

### ✅ IN SCOPE

| Item | Notes |
|---|---|
| `POST /v1/decide` with **URL input only** | No upload in MVP. Forces SSRF hardening but skips R2/multipart complexity. |
| **1 policy profile: `default_ingest`** | Hardcoded. No profile param. Validate demand before adding variants. |
| **`trust_mode=official` only** | Use [official C2PA trust list](https://github.com/c2pa-org/c2pa-official-trust-list). No legacy compare. |
| **Trust store = hardcoded snapshot** | Pulled once per release. No cron, no auto-refresh. Release cadence = trust refresh cadence. |
| **Normalization layer** | Map `c2pa-node` raw output → stable documented schema (`schema_version: "YYYY-MM-DD"`). This is the product's actual value. |
| **Decision cache by sha256** | KV, TTL 7 days. `cache_key: "sha256:<hex>"`. Returns `"cached": true` on hit. |
| **`/v1/capabilities`** (free) | Supported MIME types, limits, schema version, policy profiles available, pricing hints. |
| **`red_flags: string[]`** | Curated list of problematic patterns (signature_time_future, hash_mismatch, broken_ingredient_chain, etc.). |
| **`decision.agent_message` + `decision.human_message`** | Two texts. Agent gets short action string; human gets explanation. |
| **Fixed `reason_code` enum** | `VALID_TRUSTED_CREDENTIALS`, `VALID_UNKNOWN_SIGNER`, `NO_CREDENTIALS`, `INVALID_CREDENTIALS`, `DECLARED_AI_CONTENT`, etc. |
| **MPP payment** | Reuse current adapter. Price TBD: $0.02 for URL decide. |

### ❌ DEFERRED (v2.1+)

| Item | Why deferred |
|---|---|
| **File upload (`multipart/form-data`)** | Needs R2 storage + stream handling. 2x complexity. Ship URL first, measure demand. |
| **Additional policy profiles** (`newsroom_strict`, `osint_assist`, `ugc_marketplace`) | Speculative without customer interviews. Every customer wants their own policy anyway. |
| **`trust_mode=legacy_compare`** | Only useful for existing Adobe Verify users. Unclear demand. |
| **Trust store auto-refresh cron** | Manual snapshot per release is fine at low volume. Add cron only when trust-list churn becomes operational pain. |
| **`risk.score: 0–100`** | No ground truth for calibration. Shipping an uncalibrated "fake probability" is misleading. Stick with `red_flags` array — deterministic and defensible. |
| **OCSP / CRL revocation checks** | Network dependency, flaky endpoints, adds 50–200ms p50. Chain-to-anchor validation catches 90% of bad signers. Add when a customer reports a revoked-but-accepted cert. |
| **Audit log** (persistent request/verdict history) | GDPR/DSA implications for caching third-party content fingerprints. Don't retain unless a customer contract requires it. |
| **`Idempotency-Key` header** | Useful but not critical. Decision cache by sha256 already dedupes the common retry case (same file → same verdict). Add when a customer hits double-charge issue. |
| **`explain=true` mode** with rule-tree output | Nice-to-have, not MVP value driver. |
| **Batch endpoint** (`POST /v1/decide/batch`) | v2.1+ after single-item proven. |
| **Async jobs** (video, heavy files) | v2.2+. Not needed for image MVP. |
| **Webhook callbacks** | v2.2+. |
| **Per-customer custom policy** | v3. Contract-level work. |

---

## MVP request/response shape

### Request
```http
POST /v1/decide HTTP/1.1
Host: c2pa.mppfy.com
Authorization: Payment <mpp-credential>
Content-Type: application/json

{
  "url": "https://example.com/image.jpg"
}
```

### Response (success)
```json
{
  "request_id": "dec_01JXYZABC",
  "status": "ok",
  "cached": false,
  "schema_version": "2026-05-01",
  "policy_version": "default_ingest.1",
  "cache_key": "sha256:4d47d2d1c0a1c9...",
  "input": {
    "source_type": "url",
    "source_url": "https://example.com/image.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 1839201,
    "sha256": "4d47d2d1c0a1c9..."
  },
  "c2pa": {
    "has_manifest": true,
    "manifest_location": "embedded",
    "validation_state": "valid",
    "active_manifest_found": true,
    "signer_trust_status": "trusted",
    "remote_manifest_checked": false,
    "red_flags": []
  },
  "provenance": {
    "signer": {
      "subject": "Example Newsroom",
      "issuer": "Example CA",
      "trust_status": "trusted",
      "cert_serial": "08AF12..."
    },
    "actions": ["c2pa.created", "c2pa.edited"],
    "generator": { "tool": "Adobe Photoshop", "version": "26.1" },
    "ai_signals": {
      "declared_ai_involvement": false,
      "digital_source_type": null
    },
    "assertions_present": 7
  },
  "decision": {
    "verdict": "allow",
    "reason_code": "VALID_TRUSTED_CREDENTIALS",
    "human_message": "Content Credentials are present and valid. Signer is on the official C2PA trust list.",
    "agent_message": "Allow ingestion. No additional review needed.",
    "recommended_actions": ["ingest", "store_provenance"]
  },
  "timings_ms": {
    "fetch": 124,
    "hash": 8,
    "verify": 71,
    "trust": 12,
    "policy": 2,
    "total": 217
  }
}
```

**Explicitly absent from MVP response:** `risk.score`, `risk.confidence`, `explain.*`, `audit_id`.

---

## Policy rules (MVP, `default_ingest` only)

```typescript
function decide(s: NormalizedSignals): DecisionSummary {
  // Unreadable / parse error
  if (s.validation_state === 'unreadable') {
    return mk('reject', 'UNREADABLE_MEDIA',
      'Media could not be parsed.',
      'Reject. Media unreadable.');
  }

  // No C2PA at all
  if (!s.has_manifest) {
    return mk('warn', 'NO_CREDENTIALS',
      'No Content Credentials found on this asset.',
      'Proceed with warning. Provenance unverified.');
  }

  // Manifest present but broken
  if (s.validation_state === 'invalid') {
    return mk('needs_human_review', 'INVALID_CREDENTIALS',
      'Content Credentials present but validation failed.',
      'Route to human review. Validation failure.');
  }
  if (s.validation_state === 'partially_valid') {
    return mk('needs_human_review', 'PARTIAL_VALIDATION',
      'Content Credentials are partially valid. Some assertions could not be verified.',
      'Route to human review. Partial validation.');
  }

  // Valid manifest — now check signer + AI signals
  if (s.signer_trust_status === 'untrusted') {
    return mk('needs_human_review', 'UNTRUSTED_SIGNER',
      'Signer is on the untrusted list.',
      'Route to human review. Untrusted signer.');
  }
  if (s.signer_trust_status === 'unknown') {
    return mk('warn', 'VALID_UNKNOWN_SIGNER',
      'Credentials valid, but signer is not on the official trust list.',
      'Proceed with warning. Signer not recognized.');
  }

  // Trusted + valid — but check AI
  if (s.ai_signals.declared_ai_involvement) {
    return mk('warn', 'DECLARED_AI_CONTENT',
      'Credentials valid and trusted, but asset declares AI involvement.',
      'Proceed with AI-generated label.');
  }

  // All green
  return mk('allow', 'VALID_TRUSTED_CREDENTIALS',
    'Content Credentials are present and valid. Signer is on the official C2PA trust list.',
    'Allow ingestion. No additional review needed.');
}
```

Pure function. Deterministic. Trivial to unit-test.

---

## `reason_code` enum (MVP)

Fixed list. Adding new codes is a breaking change → bump `schema_version`.

```
VALID_TRUSTED_CREDENTIALS
VALID_UNKNOWN_SIGNER
DECLARED_AI_CONTENT
NO_CREDENTIALS
INVALID_CREDENTIALS
PARTIAL_VALIDATION
UNTRUSTED_SIGNER
UNREADABLE_MEDIA
```

Deferred codes (v2.1+): `BROKEN_CHAIN`, `REMOTE_MANIFEST_UNAVAILABLE`, `UNSUPPORTED_MEDIA_TYPE`, `POLICY_REQUIRES_HUMAN_REVIEW`, `STRICT_POLICY_REJECT`.

---

## `red_flags` curated list (MVP)

Boolean signals surfaced in `c2pa.red_flags: string[]`. Independent of verdict — informational.

```
signature_time_future         # signed with timestamp > now
signature_time_too_old        # signed > 5 years ago
hash_mismatch                 # c2pa.hash.data assertion doesn't match content
broken_ingredient_chain       # referenced ingredient manifest missing
unknown_claim_generator       # generator not in known-tool whitelist
missing_required_assertions   # no c2pa.hash.data present
self_signed_chain             # chain doesn't build to any anchor
```

---

## Dependencies

| Component | Source | Notes |
|---|---|---|
| C2PA parser | `@contentauth/c2pa-node` OR `c2patool` subprocess | Node runtime on Worker requires careful bundling; `c2patool` as WASI module may be cleaner for Worker. **Spike needed before committing.** |
| Trust anchors | Official C2PA trust list (GitHub) | Pull snapshot, commit to repo as JSON. No runtime fetch in MVP. |
| Cache | Cloudflare KV | Already provisioned via `env.CACHE`. |
| Fetcher | `fetch` with SSRF allowlist | Block private IPs, metadata endpoints, localhost. |

---

## Metric: when to unblock this work

Check weekly on `POST /verify`:

- **Green light (build this):** `>= 100 req/day` sustained 14 days, OR any paying customer emails asking for "policy verdict" / "allow/deny" output.
- **Yellow (wait):** 10–100 req/day. Monitor another 30 days.
- **Red (sunset):** `< 10 req/day` after 60 days post-launch. Shelve `/v1/decide`, treat C2PAVerify as marketing-only namespace claim, redirect effort to M1–M3.

---

## Non-goals (explicit — do not build in v2)

- ❌ Consumer-facing verify UI / web app
- ❌ Content signing (we only verify)
- ❌ Watermarking
- ❌ "Deepfake detector" heuristics (out of scope — we verify cryptographic provenance, not detect synthesis)
- ❌ Own certificate authority / issuance service
- ❌ Per-customer dashboards
- ❌ Subscription pricing — usage-based only
