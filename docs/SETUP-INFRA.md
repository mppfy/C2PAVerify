# Infra Setup — C2PAVerify (M6)

> **Status (2026-04-20):** CODE shipped. Dashboard signups + WAF rules still TODO — see checklists below.
>
> **Scope:** observability (Sentry + Axiom + BetterStack), Cloudflare WAF, GitHub Actions secrets, circuit breaker tuning. Per `mpp-project/launch/roadmap-sequenced.md` L95 these were declared W2 blocker for M6 production — они были пропущены при live deploy. Догоняем до первого organic traffic spike.
>
> **Budget update 2026-04-20:** все три провайдера пошли на Free tier — хватает для M6 MVP.
> - Sentry: Free (5k errors/mo)
> - Axiom: **Free Personal** (500 GB/mo, обновили free tier) — было запланировано $25 Starter
> - BetterStack: **Free** (10 мониторов, 3-min check, email alerts) — было запланировано $29 Team
> - **Итого $0/mo вместо $54/mo.** Upgrade'ы когда сработают триггеры: Axiom при >30× organic growth, BetterStack при появлении paying-customer SLA (нужен 30-sec check + SMS/calls), Sentry при >5k errors/mo (означает реальные проблемы, сам себя окупит).

---

## 1. Observability stack ($0/mo — все три на Free tier)

Code side: `src/observability/sentry.ts` + `src/observability/axiom.ts` уже в worker, fire-and-forget via `waitUntil`, auto no-op если env vars не заданы. Осталось завести аккаунты + поставить secrets.

### 1.1 Sentry (error tracking, free tier)

1. Go to https://sentry.io → sign up (use `mppfy.project@gmail.com`).
2. Create project → platform: **"Cloudflare Workers"** (или "JavaScript — Generic" если Workers нет в списке).
3. Project name: `c2pa-verify`. Team: default.
4. After creation → **Settings → Client Keys (DSN)** → copy DSN (looks like `https://abc123@oXXXX.ingest.sentry.io/YYYY`).
5. Put secret on both envs:

   ```bash
   cd "/Users/fedorzubrickij/Documents/Projects CODE/mppfy-work/C2PAVerify"
   wrangler secret put SENTRY_DSN --env staging
   # paste DSN, press enter
   wrangler secret put SENTRY_DSN --env production
   # paste same DSN (or a second project if strict separation desired)
   ```

6. Optional release tag — для Sentry breadcrumbs про версии:

   ```bash
   wrangler secret put SENTRY_RELEASE --env production
   # value: v0.1.0 (git describe --tags)
   ```

7. **Verify:** deploy staging with an intentional throw → Sentry Issues tab lights up within ~30s. See "Verify observability" section at bottom.

**Budget note.** Sentry free tier = 5k errors/mo. Если превышаем — первый индикатор проблемы, не расход бюджета.

### 1.2 Axiom (structured logs, **Free — Personal tier, 500 GB/mo**)

1. Go to https://axiom.co → sign up.
2. **Don't upgrade to "Axiom Cloud" ($25/mo)** — Personal/Free tier стал 500 GB/mo (обновлено ~2026 Q1). Наш трафик ≤ 150 MB/mo при 10k req/day. Upgrade только если видим >30× рост органики в Kill-review.
3. Create dataset: **`c2pa-verify`** (same name staging + prod — teg разделит через `environment` field в log payload).
3. **Settings → API tokens** → create token with `ingest` scope only. Copy token.
4. **Settings → Organization** → copy Org ID (used as `x-axiom-org-id` header).
5. Put secrets:

   ```bash
   wrangler secret put AXIOM_TOKEN --env staging
   wrangler secret put AXIOM_TOKEN --env production
   ```

6. Add dataset + org ID as vars — edit `wrangler.toml`:

   ```toml
   [env.staging.vars]
   # ...existing...
   AXIOM_DATASET = "c2pa-verify"
   AXIOM_ORG_ID = "<paste org id>"

   [env.production.vars]
   # ...existing...
   AXIOM_DATASET = "c2pa-verify"
   AXIOM_ORG_ID = "<paste org id>"
   ```

7. Redeploy (`npm run deploy:staging`). Trigger a request → Axiom Stream view should show `environment=staging service=c2pa-verify ...`.

**Budget note.** Personal (Free) = 500 GB ingest/mo (updated ~2026 Q1, previously 0.5 GB on free / 500 GB on Starter $25). Наш payload ~0.5 KB/request × 10k req/day ≈ 150 MB/mo. Room to ~30× before hitting cap. Axiom Cloud ($25/mo, 1 TB) = upgrade only if Kill-review shows >30× organic growth.

### 1.3 BetterStack (uptime + status page, **Free tier**)

> **Tier note.** Free = 10 monitors / 3-min check / email alerts / basic status page. Достаточно для MVP. $29 Team даёт 30-sec check + SMS/phone calls — нужно когда будет paying SLA.

1. Go to https://betterstack.com → Uptime → sign up.
2. Create monitor:
   - URL: `https://c2pa.mppfy.com/health`
   - Method: GET
   - Expected status: 200
   - Expected body contains: `"status":"ok"`
   - Check interval: **3 minutes** (60s on Free is more chatty than we need).
   - Regions: US-East + EU-West (probe diversity catches regional CF issues).
3. Notifications: add email + Telegram/Slack webhook if available.
4. Create second monitor for staging: `https://c2pa-staging.mppfy.com/health`, 5-min interval, email-only.
5. **Optional:** enable status page (free) at `status.mppfy.com` — good discoverability signal for soft-launch.

**Verify:** force a staging outage (`wrangler rollback` to a broken version or briefly disable worker in dashboard) → BetterStack flips to "down" within 3-6 min, email fires. Re-enable worker, verify recovery.

### 1.4 GitHub secrets (for Actions)

Required for `.github/workflows/deploy.yml`:

1. **Cloudflare API token.** Go to https://dash.cloudflare.com/profile/api-tokens → **Create Token** → template **"Edit Cloudflare Workers"** → scope to account `mppfy.project@gmail.com` (592f29d8...) → include zone `mppfy.com`. Copy the token.
2. **Cloudflare account ID.** Already in `wrangler.toml`: `592f29d8cf4b0b3492112569d9499309`.
3. Add to GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = paste token
   - `CLOUDFLARE_ACCOUNT_ID` = `592f29d8cf4b0b3492112569d9499309`
4. **Protect prod.** Settings → Environments → **New environment** `production` → add "Required reviewers" (self), "Wait timer" 0 min, protected branches `main`. Same for `staging` if you want approval gating (optional — staging usually auto).

---

## 2. Cloudflare WAF managed rules

Dashboard click-through only — no Terraform yet. Do once, verify with curl, archive screenshots in `docs/proofs/`.

### 2.1 Navigate

Cloudflare Dashboard → select zone `mppfy.com` → **Security → WAF → Custom rules**.

### 2.2 Rule A — Block obvious bots / threat score

- **Rule name:** `c2pa — threat + bot gate`
- **Field:** expression edit → paste:

  ```
  (http.host eq "c2pa.mppfy.com" and (cf.threat_score gt 30 or (cf.bot_management.score lt 30 and not cf.bot_management.verified_bot)))
  ```

- **Action:** **Managed Challenge** (НЕ Block — легитимные user-agents периодически имеют low bot score; CAPTCHA даёт эскейп-хетч, блок даёт false-positive support tickets).
- **Status:** On.

**Why these numbers.** CF threat score 0-100 (higher = worse); >30 = known abusive IP classes. Bot score 1-99 (lower = more bot-like); <30 = very likely automated. `verified_bot` whitelists Googlebot/Bing/legit crawlers.

### 2.3 Rule B — Rate limit on /verify

Not a custom rule — use **WAF → Rate limiting rules**:

- **Rule name:** `c2pa — /verify burst`
- **When incoming requests match:**

  ```
  (http.host eq "c2pa.mppfy.com" and http.request.uri.path eq "/verify")
  ```

- **Requests:** 60 per 1 minute per IP.
- **Action:** **Block** for 10 minutes.

**Why.** In-worker KV rate limit (`src/rate-limit.ts`) = 30 req/min per IP. CF edge rate limit sits in front and is **cheaper** — rejects before Worker compute. Setting edge limit 2× worker limit means normal traffic never hits edge, but burst attacks get absorbed at edge without spending Worker CPU.

### 2.4 Rule C — Geo-block high-risk countries (optional, review before enabling)

- **Rule name:** `c2pa — geo block`
- **Expression:**

  ```
  (http.host eq "c2pa.mppfy.com" and ip.geoip.country in {"KP" "IR" "SY" "CU"})
  ```

- **Action:** Block.

**Decide before enabling.** Sanctions-country blocks are standard hygiene but check legal requirements (USG OFAC list vs EU vs your LLC jurisdiction). Adding KP/IR/SY/CU is the conservative default. Skip if unsure — MVP doesn't need geo-block day one.

### 2.5 Verify

```bash
# Should succeed (200 or 402):
curl -s -o /dev/null -w '%{http_code}\n' https://c2pa.mppfy.com/health

# Should get managed challenge or 403 (simulate bad UA):
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'User-Agent: curl-scanner/1.0' \
  https://c2pa.mppfy.com/verify

# Rate limit — should eventually 429 after ~60 hits:
for i in $(seq 1 80); do
  curl -s -o /dev/null -w '%{http_code} ' https://c2pa.mppfy.com/verify
done; echo
```

Screenshot the rules list in CF dashboard → commit to `docs/proofs/waf-rules-YYYY-MM-DD.png`.

---

## 3. Circuit breaker tuning (x402 facilitator)

Code: `src/_vendor/adapters/x402-facilitator.ts` — уже deployed with defaults:

| Setting | Default | Env override |
|---------|---------|--------------|
| Primary URL | `wrangler.toml` var `X402_FACILITATOR_URL` | — |
| Fallback URL | `https://x402.org/facilitator` | `X402_FACILITATOR_FALLBACK_URL` |
| Verify timeout | 5000 ms | `X402_FACILITATOR_TIMEOUT_MS` |
| Settle timeout | 20000 ms | `X402_FACILITATOR_TIMEOUT_MS` (applied to both; wider split requires code change) |

**When to override:**
- PayAI degrades → temporarily set `X402_FACILITATOR_FALLBACK_URL` to a different provider (CDP facilitator with API key).
- Stress test → drop `X402_FACILITATOR_TIMEOUT_MS` to 1000 and watch Axiom for `facilitator_unavailable` spikes.

**How:**

```bash
wrangler secret put X402_FACILITATOR_TIMEOUT_MS --env production
# value: 5000
```

---

## 4. Verify observability end-to-end

After all three signups + WAF configured, run:

```bash
cd "/Users/fedorzubrickij/Documents/Projects CODE/mppfy-work/C2PAVerify"

# 1. Trigger a legit request (402 expected, no errors logged):
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/foo.jpg"}' \
  https://c2pa.mppfy.com/verify

# 2. Trigger an error path (malformed body → 400, logged to Axiom):
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' \
  -d 'not json' https://c2pa.mppfy.com/verify
```

Check:
- **Axiom Stream view:** should see 2 log events within 10-30s, one with `status=402` and one with `status=400`.
- **Sentry Issues:** should remain empty (no thrown exceptions on those paths — they're handled).
- **BetterStack:** monitor still green.

To prove **Sentry** works, deploy a temporary crash endpoint:

```typescript
// TEMPORARY — remove after verify
app.get('/debug/boom', () => { throw new Error('sentry smoke'); });
```

Deploy staging → curl → Sentry Issues → should show "sentry smoke" with trace_id matching the `trace_id` field in the Worker's 500 response. Remove the endpoint + redeploy.

---

## 5. Checklist — what's DONE vs TODO

Code (shipped 2026-04-20):
- [x] `src/observability/sentry.ts` — zero-dep envelope API client
- [x] `src/observability/axiom.ts` — zero-dep HTTP ingest client
- [x] `src/_vendor/core/types.ts` — env var types
- [x] `src/index.ts` — wired into `app.onError` + inner handler try/catch
- [x] `src/_vendor/adapters/x402-facilitator.ts` — timeout + fallback URL circuit breaker
- [x] `package.json` — `db:migrate:prod` script, fixed staging db name
- [x] `.github/workflows/ci.yml` — typecheck + tests on PR + main
- [x] `.github/workflows/deploy.yml` — staging on main push, production on `v*.*.*` tag

Dashboard (manual, TODO):
- [ ] Sentry signup + DSN secret (staging + prod)
- [ ] Axiom signup + token secret + `AXIOM_DATASET` + `AXIOM_ORG_ID` vars
- [ ] BetterStack uptime monitors (prod + staging)
- [ ] GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- [ ] GitHub environment: `production` with required reviewers (optional but recommended)
- [ ] CF WAF: threat/bot rule (Managed Challenge)
- [ ] CF WAF: `/verify` rate limit (60/min, block 10 min)
- [ ] CF WAF: geo-block (optional, review first)
- [ ] Screenshot WAF rules to `docs/proofs/waf-rules-YYYY-MM-DD.png`
- [ ] Verify Sentry + Axiom + BetterStack end-to-end (see §4)

Do all dashboard items in one 30-60 min session. Commit the verify proofs (curl output + screenshots) to close the loop.
