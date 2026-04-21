# v2 — Multi-Signal Authenticity Engine (Technical Spec)

**Status:** Planned (execution deferred until post-M1 launch, target W16-W22 = 2026-08-09 → 09-19).
**Supersedes:** `v2-decide-api.md` (policy-on-C2PA-only plan).
**ADR:** `mpp-project/architecture/adr-003-m6-multi-signal-pivot.md`

---

## Positioning shift

**Current (M6 v1, shipped 2026-04-20):**
> «Verify C2PA manifest. Return structured manifest data + trust_chain status.»

**v2 (multi-signal):**
> «Give agent media (URL or upload) → get action-ready authenticity verdict with signed audit trail, across C2PA + EXIF + known-tool + perceptual-hash signals.»

**Value delta:** coverage от ~5% (C2PA-signed only) до ~60-80% (all content с EXIF / matching known-tool signatures / perceptual-hash hits) + signed audit record + M1-pattern tiered pricing.

---

## Scope — ✅ IN v2 MVP

| Item | Notes |
|---|---|
| **3 tiered endpoints** | `/v1/authenticity/triage` $0.02, `/v1/authenticity` $0.05, `/v1/authenticity/evidence-pack` $0.25 |
| **URL + multipart upload** | Both supported. Existing SSRF guard reused. 25 MB cap. |
| **C2PA signal** | Existing `c2pa-rs` WASM path. No change. |
| **EXIF signal** | `exifr` (pure JS, ~20 KB), all supported MIMEs. |
| **Known-tool heuristics** | Hardcoded table of AI-tool fingerprints in EXIF `Software`, C2PA `claim_generator`, XMP `CreatorTool`. |
| **Perceptual hash vs extended bundled dataset** | `blockhash-js` / pure JS implementation. Bundled DB (~10-20 MB compressed) of pHash values: AI showcases (DALL-E/Midjourney/Firefly/SDXL) + stock photo prehashes (Unsplash/Pexels/Wikimedia Commons/Getty Editorial low-res previews). Partial reverse-image coverage without external API. |
| **Signal fusion (deterministic)** | Rule-based verdict combining per-signal outputs. No LLM. |
| **Ed25519 signed response** | Canonical JSON → signed. `signed_hash`, `signature`, `audit_id`. |
| **`missing_facts[]` + `human_review_flag{}`** | M1 pattern. Structured flags when signals ambiguous or deferred signals (SynthID) unavailable. |
| **Decision cache by sha256** | KV, TTL 7 days. `cached: true` on hit. Same price per tier (customer pays for verdict, not compute). |
| **`/v1/capabilities`** (free) | Supported MIMEs, signal list, dataset version, trust list version, endpoints, pricing. |
| **Schema version + source versions** | `schema_version`, `trust_list_version`, `ai_dataset_version` в response. |
| **MPP + x402 payment** | Existing adapter reused. Tiered pricing in `/openapi.json` accepts[]. |

## Scope — ❌ DEFERRED (v2.1+)

| Item | Why deferred |
|---|---|
| **SynthID detector integration** | Google beta access gated. Add when access granted. Encoded в `missing_facts[]` meanwhile. |
| **Reverse-image via SerpAPI (premium tier activation)** | $50/мес baseline (5000 calls), $0.001-0.005/вызов overage. **Activate only when 3+ customers explicitly request**. Added as separate premium tier with $0.15-0.25 surcharge — base tiers untouched. |
| **TinEye API (fallback path)** | $200/мес baseline. **Removed as primary reverse-image option 2026-04-20** — SerpAPI is 4× cheaper. Revisit ONLY if sustained > 5000 req/mo AND SerpAPI coverage insufficient. |
| **OCSP/CRL revocation checks** | Network dep, 50-200ms latency. Chain-to-anchor catches 90%. Add only when customer reports revoked-but-accepted cert. |
| **Meta IA watermark** | No public API. |
| **Audio + video signal support** | MVP images only. Audio/video need separate signal adapters (CLIP-like embeddings, temporal hashing). v2.2+. |
| **Batch endpoint** | `/v1/authenticity/batch` — v2.2+ after single-item proven. |
| **Async jobs** (large video) | Not needed for image MVP. |
| **Webhook callbacks** | v2.2+. |
| **Per-customer custom policy** | v3. Contract-level work. |
| **LLM-generated rationale strings** | Optional v2.1 add. Keep MVP deterministic. |
| **`explain=true` rule-tree output** | Nice-to-have, не MVP value driver. |
| **Persistent audit log** (retain verdicts server-side) | GDPR implications. Customer retains their signed copy; we don't retain. |

### Reverse-image strategy (decided 2026-04-20)

**Short answer:** MVP без external reverse-image API. Extended bundled pHash dataset покрывает ~60% «known image» use cases без внешних зависимостей.

**MVP approach (free):**
1. Bundled pHash DB включает не только AI showcases, но и stock photo prehashes:
   - **Unsplash** free license subset (~500k top downloaded photos pre-hashed)
   - **Pexels** free license subset (~200k top downloaded pre-hashed)
   - **Wikimedia Commons** public domain images (~100k most-used)
   - **Getty Editorial** low-resolution preview pHashes (публично доступны в их API preview, не полные фотки)
2. Total dataset: ~10-20 MB compressed (fits R2 bucket, loaded into KV at startup)
3. На incoming image → pHash → nearest-neighbor search в bundled DB → если match found → report «matches known stock photo X» / «matches public showcase Y»
4. **Честный gap:** не находит reverse-image для unique/private images. В `missing_facts[]` указываем «full reverse-image-search not performed — recommend external (TinEye/Google Lens) if first-seen date needed»

**Post-MVP premium tier (if customer demand):**
- Trigger: 3+ paying customers explicitly request reverse-image в interviews / feature requests
- Activate **SerpAPI Developer tier** ($50/мес, 5000 calls) — в 4 раза дешевле TinEye
- Create **`POST /v1/authenticity/premium`** endpoint at $0.20-0.25/call with included reverse-image lookup
- Premium surcharge covers SerpAPI cost + margin: $0.20 - $0.005 SerpAPI = $0.195 маржа (97%)
- Base tiers (triage/authenticity/evidence-pack) untouched — no price change

**TinEye deferred as fallback only:** $200/мес makes it prohibitive at MVP volume. Revisit **только если** (a) SerpAPI coverage proves insufficient from customer feedback AND (b) sustained > 5000 req/mo puts us into TinEye's volume-discount negotiation zone.

---

## Endpoint 1: `POST /v1/authenticity/triage`

**Price:** $0.02  
**Purpose:** Fast path — bulk scans, routing, cheap triage decisions.  
**Signals used:** C2PA (existence check) + EXIF (Software tag) + known-tool heuristic. **No perceptual hash, no Ed25519.**

### Request
```http
POST /v1/authenticity/triage HTTP/1.1
Host: c2pa.mppfy.com
Authorization: Payment <cred>
Content-Type: application/json

{ "url": "https://example.com/image.jpg" }
```
Or multipart upload (same as v1 `/verify`).

### Response
```json
{
  "request_id": "tri_01JXYZ...",
  "schema_version": "2026-09-01",
  "verdict": {
    "label": "likely_ai_generated",
    "confidence": 0.85,
    "primary_signal": "exif_software_tag",
    "one_liner": "EXIF Software field identifies DALL-E 3; no contrary signals"
  },
  "cached": false,
  "latency_ms": 42
}
```

**Verdict labels** (same enum across all 3 endpoints):
- `likely_authentic` — signals suggest camera-originated or trusted-signed authentic content
- `likely_ai_generated` — strong AI fingerprint (EXIF tool tag, C2PA claim_generator matches AI tool, pHash match)
- `mixed_signals` — conflicting evidence (e.g., authentic C2PA signer but EXIF suggests AI tool)
- `insufficient_data` — no actionable signals (no C2PA, stripped EXIF, no pHash match)
- `unreadable_media` — parse error

---

## Endpoint 2: `POST /v1/authenticity` (main product)

**Price:** $0.05  
**Purpose:** Full multi-signal fusion + signed audit record.  
**Signals used:** All MVP signals (C2PA + EXIF + known-tool + perceptual hash).

### Request
Same shape as triage (URL or multipart).

### Response (full schema)
```json
{
  "request_id": "auth_01JXYZ...",
  "audit_id": "aud_4d47d2d1...",
  "schema_version": "2026-09-01",
  "issued_at": "2026-09-15T12:00:00Z",
  "trust_list_version": "CAI-2026-08-15",
  "ai_dataset_version": "mppfy-ai-phash-2026-08-10",
  "signed_hash": "sha256:4d47d2d1c0a1c9...",
  "signature": "ed25519:...",
  "cached": false,

  "input": {
    "source_type": "url",
    "source_url": "https://example.com/image.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 1839201,
    "sha256": "..."
  },

  "verdict": {
    "label": "likely_ai_generated",
    "confidence": 0.92,
    "rationale": "EXIF Software=DALL-E 3 (high-confidence known-tool match); no C2PA manifest; perceptual hash within distance=4 of DALL-E-3 public showcase dataset (threshold=8). No contrary signals.",
    "recommended_actions": ["label_as_ai", "store_provenance", "no_human_review_needed"]
  },

  "signals": {
    "c2pa": {
      "status": "absent",
      "manifest_present": false,
      "checked_at": "2026-09-15T12:00:00.042Z"
    },
    "exif": {
      "status": "ok",
      "software": "DALL-E 3",
      "datetime_original": null,
      "camera_make": null,
      "camera_model": null,
      "gps_present": false,
      "known_ai_tool_match": {
        "tool": "openai_dalle_3",
        "match_source": "software_tag",
        "confidence": 0.95
      }
    },
    "known_tool": {
      "status": "ok",
      "detected": "dall-e-3",
      "confidence": 0.95,
      "sources": ["exif_software_tag"],
      "is_ai_tool": true
    },
    "perceptual_hash": {
      "status": "ok",
      "phash": "f7e3a1c904b2...",
      "nearest_match": {
        "dataset": "dalle-3-public-showcase",
        "dataset_size": 12500,
        "distance": 4,
        "threshold": 8,
        "is_match": true
      }
    }
  },

  "missing_facts": [
    {
      "question": "Is SynthID watermark present?",
      "why_matters": "Would add independent signal; currently not checked (API access pending).",
      "affects": ["confidence"]
    }
  ],

  "human_review_flag": {
    "required": false,
    "reasons": []
  },

  "red_flags": [],

  "disclaimer": "Machine-readable authenticity triage. Not forensic proof. Combine with human review for legal or editorial decisions. Signal set documented at /v1/capabilities."
}
```

### `human_review_flag.required = true` triggers
- `verdict.label = mixed_signals`
- Any signal status = `error` AND другие signals confidence < 0.7
- pHash match с distance ∈ [threshold-2, threshold+2] (borderline zone)
- C2PA `trust_chain = partial` AND no other AI signals (ambiguous)

### `red_flags[]` (informational, independent of verdict)
```
signature_time_future
signature_time_too_old
hash_mismatch
broken_ingredient_chain
unknown_claim_generator
self_signed_chain
exif_software_stripped_but_metadata_residue
phash_matches_known_fake_dataset
contradictory_signals_detected
```

---

## Endpoint 3: `POST /v1/authenticity/evidence-pack`

**Price:** $0.25  
**Purpose:** Compliance / legal audit-grade evidence. Customer's tamper-evident record.  
**Signals used:** Same as `/v1/authenticity` + full canonical JSON + stronger signing commitments.

### Additional fields vs `/v1/authenticity`

```json
{
  ...all /v1/authenticity fields...,
  "evidence_pack": {
    "canonical_json_sha256": "sha256:...",
    "signature_algorithm": "Ed25519",
    "signer_public_key": "ed25519:...",
    "signer_key_id": "mppfy-c2pa-signing-key-2026-q3",
    "issuer": "MPPFY Authenticity Engine",
    "issuer_url": "https://c2pa.mppfy.com/evidence-pack-spec",
    "applicable_disclaimers": [
      "Valid at time of issuance; signals and trust list versions locked.",
      "Not a substitute for forensic analysis."
    ],
    "supporting_artifacts": {
      "input_sha256": "...",
      "signal_source_versions": {
        "c2pa_rs": "0.5.0",
        "exifr": "7.1.3",
        "ai_dataset": "mppfy-ai-phash-2026-08-10",
        "cai_trust_list": "CAI-2026-08-15"
      }
    }
  }
}
```

Customer preserves full response → can later prove:
1. What content was verified (sha256 + size)
2. Which signals were checked (versions locked)
3. What verdict was issued (signed by our key)
4. When (`issued_at`)

**Price rationale:** $0.25 = 5× main endpoint. Justifies additional write-path (audit_id durable store), stronger operational commitments (we keep signing key available for 2 years for verification queries).

---

## `/v1/capabilities` (free)

```json
{
  "service": "c2pa-verify",
  "version": "v2",
  "schema_version": "2026-09-01",
  "endpoints": [
    { "path": "/v1/authenticity/triage", "price_usdc": "0.02" },
    { "path": "/v1/authenticity", "price_usdc": "0.05" },
    { "path": "/v1/authenticity/evidence-pack", "price_usdc": "0.25" },
    { "path": "/verify", "price_usdc": "0.01", "note": "v1 legacy, deprecated" }
  ],
  "supported_mime_types": [
    "image/jpeg", "image/png", "image/webp", "image/tiff",
    "image/avif", "image/heic", "image/heif"
  ],
  "max_size_bytes": 26214400,
  "signals": [
    { "name": "c2pa", "status": "active", "source_version": "c2pa-rs-0.5.0" },
    { "name": "exif", "status": "active", "source_version": "exifr-7.1.3" },
    { "name": "known_tool", "status": "active", "source_version": "mppfy-rules-2026-08" },
    { "name": "perceptual_hash", "status": "active", "source_version": "mppfy-ai-phash-2026-08-10" },
    { "name": "synthid", "status": "deferred", "reason": "Google beta API access pending" },
    { "name": "reverse_image", "status": "deferred", "reason": "Unit economics not yet justified" }
  ],
  "trust_list_version": "CAI-2026-08-15",
  "ai_dataset_version": "mppfy-ai-phash-2026-08-10",
  "signing_key": {
    "algorithm": "Ed25519",
    "public_key": "ed25519:...",
    "key_id": "mppfy-c2pa-signing-key-2026-q3"
  }
}
```

---

## Signal fusion logic (pseudocode)

```typescript
function fuseSignals(signals: SignalOutputs): Verdict {
  const scores = {
    ai: 0,       // 0-1, likelihood AI-generated
    authentic: 0 // 0-1, likelihood camera-authentic
  };
  const rationaleParts: string[] = [];

  // C2PA signal (strongest when present)
  if (signals.c2pa.status === 'ok' && signals.c2pa.manifest_present) {
    if (signals.c2pa.claim_generator_matches_ai) {
      scores.ai += 0.8;
      rationaleParts.push(`C2PA claim_generator=${signals.c2pa.generator} (AI tool)`);
    } else if (signals.c2pa.trust_chain === 'valid' && signals.c2pa.signer_trusted) {
      scores.authentic += 0.7;
      rationaleParts.push(`C2PA valid trusted signer ${signals.c2pa.signer}`);
    }
  }

  // EXIF + known-tool
  if (signals.exif.known_ai_tool_match) {
    scores.ai += 0.7 * signals.exif.known_ai_tool_match.confidence;
    rationaleParts.push(`EXIF Software=${signals.exif.software} (known AI tool)`);
  } else if (signals.exif.camera_make && signals.exif.datetime_original) {
    scores.authentic += 0.4;
    rationaleParts.push(`EXIF camera metadata present (${signals.exif.camera_make})`);
  }

  // Perceptual hash
  if (signals.perceptual_hash.nearest_match?.is_match) {
    scores.ai += 0.5;
    rationaleParts.push(
      `pHash matches ${signals.perceptual_hash.nearest_match.dataset} (dist=${signals.perceptual_hash.nearest_match.distance})`
    );
  }

  // Fusion + label
  const aiClamped = Math.min(scores.ai, 1);
  const authClamped = Math.min(scores.authentic, 1);
  const margin = Math.abs(aiClamped - authClamped);

  let label: VerdictLabel;
  let confidence: number;

  if (aiClamped >= 0.7 && margin > 0.3) {
    label = 'likely_ai_generated';
    confidence = aiClamped;
  } else if (authClamped >= 0.6 && margin > 0.2) {
    label = 'likely_authentic';
    confidence = authClamped;
  } else if (aiClamped > 0.2 && authClamped > 0.2) {
    label = 'mixed_signals';
    confidence = 1 - margin;
  } else {
    label = 'insufficient_data';
    confidence = 0.5;
  }

  return {
    label,
    confidence: Number(confidence.toFixed(2)),
    rationale: rationaleParts.join('; ') || 'No actionable signals extracted.',
    recommended_actions: pickActions(label, confidence)
  };
}
```

**Calibration:** thresholds (0.7, 0.6, 0.3, 0.2) tuned against labeled dataset (~50 images: 25 known-AI + 25 known-authentic + handful edge cases). Same methodology as M1 confidence calibration.

---

## Labeled dataset for calibration (~50 images)

| Category | Count | Source |
|---|---|---|
| Known AI (DALL-E 3, Midjourney v6, Stable Diffusion XL, Firefly) | 20 | Public showcases + OpenAI gallery + Adobe samples |
| Camera-authentic (DSLR, iPhone) | 15 | Public domain / Creative Commons photos с intact EXIF |
| Stripped EXIF authentic | 5 | CC photos с removed metadata (common on social) |
| Re-encoded AI (social-media reshare) | 5 | Re-saved AI images (tests pHash resilience) |
| Adversarial / edge cases | 5 | Heavily edited authentic, AI upscaled authentic, composites |

Stored в `C2PAVerify/test/fixtures/authenticity/` с same YAML schema as M1 labeled dataset.

---

## Implementation breakdown (~60-80h)

| Task | Hours |
|---|---|
| EXIF parser integration (`exifr`) + known-tool heuristic table | 15 |
| Perceptual hash implementation + **extended bundled dataset** (AI showcases + Unsplash/Pexels/Wikimedia/Getty prehashes, build pipeline + nearest-neighbor search) | 25 |
| Signal fusion + threshold calibration | 15 |
| Ed25519 signing + canonical JSON + `audit_id` KV store | 8 |
| Labeled dataset collection + regression suite (~50 images) | 10 |
| 3 tiered endpoint wiring + OpenAPI + llms.txt regeneration | 8 |
| MCP server upgrade (new tool definitions for tiered endpoints) | 4 |
| **Total** | **~85h** |

Stretch (v2.1+):
- SynthID integration (if access granted): +10h
- **SerpAPI Google Lens + premium tier `/v1/authenticity/premium`** (if 3+ customer requests): +15h
- TinEye integration (only if SerpAPI insufficient AND volume > 5000/mo): +15h
- Audio/video signal adapters: +40h

---

## Dependencies

| Component | Source | License | Notes |
|---|---|---|---|
| C2PA parser | `@contentauth/c2pa-wasm` 0.5.0 (existing) | Apache-2.0 | Already embedded |
| EXIF parser | `exifr` | MIT | ~20 KB minified, Workers-compatible |
| Perceptual hash | `blockhash-js` или custom pure-JS pHash | MIT | ~10 KB |
| pHash dataset (extended) | Bundled in `src/authenticity/datasets/` (pHash values only, ~10-20 MB): AI showcases + Unsplash + Pexels + Wikimedia Commons + Getty Editorial previews | Mix (CC-BY, public domain, CC0, Getty preview terms) | Pre-built at release time via build script; each source under compatible license for pHash derivation |
| Signing | `@noble/ed25519` | MIT | Already used elsewhere в scaffold, tiny |
| Storage | CF KV (`env.CACHE`) + durable R2 (`AUDIT_PACK`) — new binding | — | Audit pack retention 2 years |

**New infra:** R2 bucket `c2pa-authenticity-audit` for evidence-pack tier (2-year retention of signed response copies for customer verification queries). Est. cost: $0.015/GB/month storage + $0.36/million Class A ops. Negligible at launch scale.

---

## Metric: v2 go/no-go (W16 Phase 0 checkpoint)

**Green light (build v2):** Any of:
- M6 v1 `/verify` ≥ 100 req/day sustained 14 days post-launch
- 3+ inbound customer interviews requesting «AI-or-not verdict» / multi-signal fusion
- M1 launch successful AND bandwidth available (not firefighting M1 issues)

**Yellow (narrow scope):** 30-100 req/day. Build Phase 1+2 only (main endpoint, skip evidence-pack tier).

**Red (cancel):** <10 req/day after 60 days post-v1 launch → deprecate M6 entirely, redirect к B5/D14/D15/N1 Wave 1 completion.

---

## Non-goals (explicit — do NOT build in v2)

- ❌ Deepfake detection heuristics (facial analysis, synthesis artifact detection) — separate skill, out of scope
- ❌ Watermark embedding / signing (we verify; we don't sign customer content)
- ❌ Own certificate authority
- ❌ Consumer-facing UI / web app
- ❌ Per-customer custom policy engine (deferred to v3 contract-level)
- ❌ Subscription pricing — pay-per-call only
- ❌ Video / audio support in v2 MVP — images only
- ❌ LLM-generated rationale in v2 MVP — deterministic only (LLM as v2.1 opt-in)

---

## Migration from v1

- **v1 `/verify`** endpoint stays live и functional. Marked `status: 'deprecated'` в registry — returns 200 + `x-service-deprecated: true` header + `Deprecation` header pointing к v2.
- Documentation update: `llms.txt`, `openapi.json`, README point к v2 as primary; v1 retained for existing integrations.
- Kill-review v1 at v2 launch + 60 days: if v1 traffic <5% of v2 → full deprecation (410 Gone).

---

*Created 2026-04-20 as v2 technical spec. Supersedes `v2-decide-api.md`. Execution deferred to W16 2026-08-09 post-M1 launch per ADR-003. Review trigger: M1 launch outcome (2026-08-02) or competitive landscape shift.*
