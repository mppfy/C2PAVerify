# x402 Integration Roadmap

**Current status (2026-04-20):** Stage 2 shadow deployed in production. Dual-protocol (MPP + x402) active on `c2pa.mppfy.com`. Default protocol = MPP; x402 opt-in via `X-PAYMENT` header or `x-payment-protocol: x402` override.

**Facilitator:** PayAI (`https://facilitator.payai.network`) — public, free, auto-catalogs services in PayAI Bazaar on first real payment.

**Catalog coverage (now):**
- ✅ MPPScan (via MPP protocol path)
- ✅ PayAI Bazaar (auto-listed after first organic x402 payment through prod)

---

## What's deferred (explicit not-doing-yet list)

### ~~CDP facilitator (Coinbase-operated Bazaar)~~ — SHIPPED 2026-04-21 (PR #3)

**Status:** live in production alongside PayAI. Pool mode via `X402_FACILITATOR_URLS`. See `src/_vendor/adapters/x402-facilitator.ts::createFacilitatorPool` + `src/index.ts::buildFacilitatorPool`.

**Actual shape (differs from original sketch):**
- `X402_FACILITATOR_URLS="url|label,url|label"` — label allows per-facilitator observability tagging
- Pool round-robins across primaries; **sticky verify↔settle** (closure-pinned `PickedFacilitator`, not just `X402FacilitatorClient` — exposes only the two methods, prevents accidental bypass of fallback guards)
- Pool-level fallback (single shared `x402.org`) instead of per-client internal fallback — prevents double-fallback cascade and keeps verify/settle routing coherent
- **Settle has NO fallback** — settlement state lives on the primary that verified; cross-facilitator settle would risk double-charge or stranded payments
- CDP auth injected via exact-hostname allowlist (not substring match — see `src/_vendor/adapters/x402-url.ts`; substring match in original sketch was a credential-exfil CVE waiting to happen)
- HTTPS-only guard on every facilitator URL (no plaintext over-the-wire for EIP-712 signatures)

Env vars:
- `X402_FACILITATOR_URLS="https://facilitator.payai.network|payai,https://api.cdp.coinbase.com/platform/v2/x402|cdp"`
- `X402_CDP_API_KEY_ID` (secret, production only)
- `X402_CDP_API_KEY_SECRET` (secret, production only — PEM EC or base64 Ed25519)

Test coverage: 10 pool tests + 6 URL predicate tests (total 86/86 passing).

Rollback: drop CDP entry from `X402_FACILITATOR_URLS`, redeploy. Adapter works with N≥1 primaries.

---

### Stage 3: flip DEFAULT_PROTOCOL to x402

**Trigger:** 7 days of clean prod shadow traffic + non-zero x402 payment volume (even if just 1-2 payments).

**Change:** `wrangler.toml` prod → `DEFAULT_PROTOCOL = "x402"`. MPP stays as fallback for clients that still send `Authorization: Payment`.

**Why not immediately:** no MPP client breakage risk, but x402 adapter has untested failure modes in prod volume. Gate on real traffic.

---

### PaymentRequirements enrichment (Bazaar input/output schema)

**Current state:** `buildX402Requirements()` emits a minimal `outputSchema.input = { type: 'http', method: 'POST', discoverable: true }`. This is enough for Bazaar to catalog, but agents can't tell from the listing what parameters to send or what they'll get back.

**What's missing:**
- `inputSchema` with typed parameters (`{url: string}` for JSON body, `{file: binary}` for multipart)
- `outputSchema.output` describing the manifest response shape
- Richer `description` with use-case examples

**Trigger to do:** listing appears in PayAI Bazaar but gets no organic clicks despite other signals being green — could mean agents see the listing but can't tell what it does.

**Effort:** ~30-45 min to write schema + update `buildX402Requirements()` + unit tests.

---

### Weekly keep-alive payment (NOT doing — listed for completeness)

**Rejected option:** cron-triggered self-payment to keep Bazaar listing fresh.

**Why rejected:**
- Pollutes demand-signal metric (artificial activity → can't tell organic from self)
- Requires private key in Worker secrets (security surface)
- Small but recurring $ cost
- May be flagged/throttled by facilitator as sybil-like behavior

If PayAI listing degrades without traffic (catalog TTL), accept degradation as signal: no traffic = no demand = shelve per `docs/v2-decide-api.md` sunset criteria.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-20 | Ship Stage 1 (MPP-only prod) | Baseline before dual-protocol |
| 2026-04-20 | Ship Stage 2 shadow (PAYMENT_MODE=multi, DEFAULT_PROTOCOL=mpp) | Backward-compatible; x402 opt-in |
| 2026-04-20 | Switch prod facilitator x402.org → PayAI | x402.org has no catalog; PayAI = free Bazaar listing |
| 2026-04-21 | Add CDP facilitator alongside PayAI (pool mode) | PR #3. Decided NOT to wait for organic signal — the incremental eng cost is ~2 hrs, Bazaar listings are free, and having both PayAI + CDP catalogs doubles the discovery surface. `X402_FACILITATOR_URLS` = PayAI + CDP (round-robin), fallback = x402.org. Sticky verify↔settle pin + 6 URL predicate tests guard against credential-exfil on CDP substring match. |
| TBD | Flip DEFAULT_PROTOCOL to x402 | Pending 7d clean shadow + organic traffic |

---

## Metrics to watch

Analytics Engine fields (per `/verify` request):
- `protocol` — which path ran (`mpp` / `x402` / `none`)
- `detectionReason` — which header triggered routing (`auth-payment` / `x-payment` / `explicit-header` / `default`)
- `detectedProtocol` — what multi-adapter decided

**Review cadence:** weekly for first 30 days, monthly after.

**Key thresholds** (aligned with `docs/v2-decide-api.md`):
- Green (expand): x402 ≥ 10 req/day sustained 14 days → add CDP facilitator
- Yellow (wait): x402 1-10 req/day → monitor another 30 days
- Red (shelve): x402 = 0 after 60 days → accept no-demand-for-x402 verdict, possibly revert to MPP-only to reduce maintenance surface
