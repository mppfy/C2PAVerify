# x402 Integration Roadmap

**Current status (2026-04-20):** Stage 2 shadow deployed in production. Dual-protocol (MPP + x402) active on `c2pa.mppfy.com`. Default protocol = MPP; x402 opt-in via `X-PAYMENT` header or `x-payment-protocol: x402` override.

**Facilitator:** PayAI (`https://facilitator.payai.network`) — public, free, auto-catalogs services in PayAI Bazaar on first real payment.

**Catalog coverage (now):**
- ✅ MPPScan (via MPP protocol path)
- ✅ PayAI Bazaar (auto-listed after first organic x402 payment through prod)

---

## What's deferred (explicit not-doing-yet list)

### CDP facilitator (Coinbase-operated Bazaar)

**Why we want it:** second major Bazaar catalog. CDP-native agents (built with Coinbase's SDK/CDP APIs) query the CDP discovery endpoint by default, not PayAI. Not being in the CDP catalog means CDP-native agents can't find us via discovery — they'd have to know our URL out-of-band.

**Why we haven't done it:**
- Requires Coinbase Developer account + CDP API key (free but manual signup, ~10-15 min)
- Requires ~1-2 hours of engineering:
  - Extend `X402_FACILITATOR_URL` → `X402_FACILITATOR_URLS` (comma-separated list)
  - Add `createAuthHeaders` support in `x402-facilitator.ts` (CDP requires JWT auth header)
  - Sticky facilitator selection in `x402.ts` — verify() and settle() for same payment must hit same facilitator (they share server-side state per payment); store choice in `PendingPayment` WeakMap
  - Round-robin or weighted selection policy for choosing facilitator on first hit
  - Unit tests for pool logic (sticky selection, fallback on facilitator outage)
  - Observability: log which facilitator handled each payment → Analytics Engine
- Operational complexity doubles (two APIs to monitor, two failure modes, two rate-limit budgets)

**Trigger to build:**
- PayAI gives ≥3 organic x402 payments in 30 days (demand signal confirmed; worth expanding reach), OR
- A customer/user reports "tried to find c2pa-verify through CDP agent, couldn't" (explicit CDP demand), OR
- Stage 3 flip (`DEFAULT_PROTOCOL="x402"`) approaches and we want maximum discoverability at cut-over

**Implementation sketch (when triggered):**

```typescript
// src/_vendor/adapters/x402-facilitator.ts — extend to support pool
export interface FacilitatorPoolConfig {
  primaries: Array<{
    url: string;
    createAuthHeaders?: FacilitatorConfig['createAuthHeaders'];
    weight?: number; // optional traffic split
  }>;
  fallback?: { url: string }; // x402.org as last-resort
}

// src/_vendor/adapters/x402.ts — sticky selection
interface PendingPayment {
  readonly decoded: PaymentPayload;
  readonly requirements: PaymentRequirements;
  readonly facilitator: X402FacilitatorClient; // pinned at verify() time
}
```

Env vars added:
- `X402_FACILITATOR_URLS="https://facilitator.payai.network,https://api.cdp.coinbase.com/platform/v2/x402/facilitator"`
- `X402_CDP_API_KEY_ID` (secret)
- `X402_CDP_API_KEY_SECRET` (secret)

Rollback: set back to single URL via existing `X402_FACILITATOR_URL`, redeploy. Adapter code keeps both paths.

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
| TBD | Sign up CDP API key + add facilitator pool | Pending first organic x402 signal |
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
