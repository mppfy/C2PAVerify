# C2PA Verify — Launch Kit

Всё для публикации в одном файле. Копируй блоки и постит их.

---

## 0. Proof artifacts (ссылки для всех постов)

| Что | Ссылка |
|---|---|
| Live endpoint | https://c2pa.mppfy.com/verify |
| GitHub repo | https://github.com/mppfy/C2PAVerify |
| OpenAPI discovery | https://c2pa.mppfy.com/openapi.json |
| llms.txt | https://c2pa.mppfy.com/llms.txt |
| First real payment tx (Base mainnet) | https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6 |
| Recipient wallet (prod) | https://basescan.org/address/0xe0a12D71bcc1027f0B511794A2fACe0B3f2337A2 |

**Команды для верификации** (гостю убедиться что живое):
```bash
# 402 challenge — должен вернуть JSON с accepts[]
curl -sS -i -X POST https://c2pa.mppfy.com/verify \
  -H 'x-payment-protocol: x402' \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/signed.jpg"}' | head -40

# OpenAPI — должен вернуть /verify path с x-payment-info
curl -s https://c2pa.mppfy.com/openapi.json | head -50
```

---

## 1. Расписание постинга

| День | Канал | Окно публикации (UTC) | Action |
|---|---|---|---|
| **Day 1** | Twitter/X thread + dev.to article | Вт-Чт 14:00-16:00 | Block 2 + Block 3 |
| **Day 2** (+24h) | r/LocalLLaMA | Вт-Чт 14:00-18:00 | Block 4 |
| **Day 3** (+48h) | r/AgenticAI или r/AI_Agents | Ср-Пт 14:00-18:00 | Block 5 |
| **Day 4** (+72h) | r/MachineLearning `[Project]` | Только Вт-Чт 15:00-17:00 | Block 6 |
| **Optional** | Show HN, PayAI Discord, x402 Discord | любой день в неделе | Block 7 |

**Правило первых 2 часов**: на каждом канале отвечай на все топ-левел комменты. Reddit ranking / Twitter visibility решается engagement velocity первых 120 минут.

---

## 2. Twitter/X thread (7 постов)

### Pre-post setup

1. Открой новый терминал → выполни:
   ```bash
   curl -sS -i -X POST https://c2pa.mppfy.com/verify \
     -H 'x-payment-protocol: x402' \
     -H 'content-type: application/json' \
     -d '{"url":"https://example.com/signed.jpg"}' | head -40
   ```
2. Сделай скриншот вывода — нужен для Post 3. Должно быть видно:
   - `HTTP/2 402`
   - `x-payment-protocol: x402`
   - JSON с `"x402Version": 1`, `"network": "base"`, `"asset": "0x833589..."`
3. Запусти `npx wrangler tail --env production` в отдельном терминале — будешь видеть live traffic.

### Post 1 — hook (ЗАПИНИ после публикации)

```
Launched: an agent-native C2PA manifest verification API. Pay per call — no accounts, no subscriptions, no API keys.

$0.01 USDC per verification, dual-protocol: x402 on Base (@base) or MPP on Tempo.

Live: c2pa.mppfy.com 👇
```

Теги: `@coinbasedev @base @CAI_Developers @PayAINetwork`

### Post 2 — why

```
Agents downloading media from the open web have no built-in way to check: was this AI-generated, edited, or authentically captured?

C2PA (adopted by Adobe, Microsoft, BBC, Sony, OpenAI) embeds signed provenance. Parsing it normally means embedding a ~15 MB Rust/WASM verifier. We offload it to one HTTP call.
```

### Post 3 — demo (ПРИАТТАЧЬ СКРИНШОТ)

```
One curl to see the 402 challenge:

curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'x-payment-protocol: x402' \
  -d '{"url":"https://example.com/signed.jpg"}'

→ 402 with accepts:[{scheme:"exact", network:"base", asset:USDC, amount:"10000"}]

Your x402 client SDK handles the rest.
```

### Post 4 — dual protocol

```
We support both x402 (@coinbasedev HTTP payment spec, Base settlement) and MPP (Tempo chain). Clients pick via `Authorization: Payment` (MPP) or `X-PAYMENT` (x402). Discovery via /openapi.json advertises both.

No vendor lock-in for the agent; same $0.01 price either way.
```

### Post 5 — response shape

```
Success response:

{
  "verified": true,
  "manifest": {
    "claim_generator": "Adobe Firefly 2.5",
    "signed_by": "CAI Intermediate CA",
    "assertions": [...]
  },
  "trust_chain": "valid"
}

trust_chain ∈ valid | partial | unknown. Uses the current CAI trust list baked into the Worker.
```

### Post 6 — under the hood

```
- Cloudflare Workers, region-less
- c2pa-rs compiled to WASM (~1.9 MB gzipped)
- Verify + settle via PayAI facilitator on Base mainnet
- Discovery at /openapi.json + /llms.txt
- First real x402 payment settled: basescan.org/tx/0xb6c70324…

Source: github.com/mppfy/C2PAVerify (MIT)
```

### Post 7 — CTA

```
If you're building agents that ingest third-party media — try it. curl-level quick-start in the README.

If you'd rather pay in MPP (Tempo USDC), that's first-class too. Roadmap in docs/x402-roadmap.md.

Feedback: replies or GitHub issues welcome.

#x402 #AgentPayments #C2PA
```

### Reply под Post 6 (после публикации dev.to)

```
Full architecture write-up on dev.to: <ссылка на dev.to статью>
```

### Single-tweet fallback (если не хочешь thread)

```
Shipped: agent-native C2PA manifest verification. Pay-per-call, $0.01 USDC, dual-protocol (x402 on Base + MPP on Tempo). No accounts, no API keys.

Live: c2pa.mppfy.com
Source: github.com/mppfy/C2PAVerify
Proof: basescan.org/tx/0xb6c70324…

#x402 #AgentPayments #C2PA
```

---

## 3. Dev.to статья

### Метаданные для публикации

- **URL для Write a post**: https://dev.to/new
- **Title**: `How we shipped a dual-protocol (x402 + MPP) paid API in a weekend`
- **Tags**: `api`, `crypto`, `agents`, `cloudflare`, `typescript`
- **Canonical URL**: `https://c2pa.mppfy.com`
- **Cover image**: скриншот `curl -i` 402 response (тот же что для Twitter Post 3)

### Тело статьи (copy-paste целиком)

```markdown
## The problem

We wanted to ship a pay-per-call API for C2PA manifest verification — the kind of service an AI agent should be able to discover, pay, and consume without a human ever signing up. Two payment protocols fit the brief:

- **[x402](https://x402.org)** — Coinbase's HTTP-native payment spec. USDC on Base. Agent signs an [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) authorization; facilitator broadcasts.
- **[MPP](https://mpp.dev)** — Machine Payments Protocol. USDC on Tempo chain. Agent signs a challenge; we settle on-chain.

Picking *one* felt like betting on the wrong horse. Agent ecosystems fragment around which protocol they "speak" first — x402-native clients query x402 facilitator catalogs; MPP-native clients hit MPPScan. A single-protocol API means invisibility to half the audience.

So: both. But how without shoving protocol details into every endpoint?

---

## The architecture

One `PaymentAdapter` interface. Both protocols implement it. A thin `MultiProtocolAdapter` dispatches based on request signals.

\`\`\`ts
interface PaymentAdapter {
  readonly name: string;
  detects(request: Request): boolean;
  verify(request: Request, req: PaymentRequirement): Promise<PaymentVerification | null>;
  create402(req: PaymentRequirement, request: Request): Response;
  attachReceipt(response: Response, verification: PaymentVerification): Response;
  settle?(request: Request, response: Response, verification: PaymentVerification): Promise<Response>;
}
\`\`\`

The handler never imports `x402/verify` or `mppx`. It just asks the adapter: "is this request paid?" and "build me the 402 challenge."

### Protocol detection (pure function, easy to test)

\`\`\`ts
function detectProtocol(request: Request, opts: { defaultProtocol: 'mpp' | 'x402' }): DetectionResult {
  // 1. Explicit override wins.
  const override = explicitProtocolSchema.safeParse(request.headers.get('x-payment-protocol'));
  if (override.success) return { protocol: override.data, reason: 'explicit-header' };

  // 2. Wire signals.
  const auth = request.headers.get('authorization') ?? '';
  if (/^payment\s/i.test(auth)) return { protocol: 'mpp', reason: 'auth-payment' };
  if (request.headers.get('x-payment')) return { protocol: 'x402', reason: 'x-payment' };

  // 3. Soft hint.
  const accept = request.headers.get('accept') ?? '';
  const m = accept.match(/application\/vnd\.(mpp|x402)/i);
  if (m) return { protocol: m[1].toLowerCase() as 'mpp' | 'x402', reason: 'accept-vendor' };

  // 4. Default.
  return { protocol: opts.defaultProtocol, reason: 'default' };
}
\`\`\`

Zod enum parsing on the header means malformed input (`x-payment-protocol: bitcoin`) falls through to the next precedence step instead of throwing. The reason tag gets written to analytics — we can see *why* every request got routed the way it did.

### Sync verify, async settle

A gotcha: x402 requires an **async** facilitator call at settlement time (to broadcast the EIP-3009 auth). But `attachReceipt()` is sync — it just adds headers. We'd originally wired x402 with no settle call, so payments verified but USDC never moved. Silent bug because we had no organic traffic yet.

Fix: add an optional `settle()` to the interface. MPP doesn't need it. x402 implements it. Dispatcher forwards by `verification.protocol`.

\`\`\`ts
// in /verify handler
let response = await c2paVerify.handler(c);
response = adapter.attachReceipt(response, verification);
if (adapter.settle) {
  response = await adapter.settle(c.req.raw, response, verification);
}
return response;
\`\`\`

The settle path also gates on `response.status < 300` — we never settle payment for a 500 handler. Small thing, hostile not to have it.

---

## Rollout strategy: shadow mode

Prod is dual-protocol already, but default is still MPP. Stage 2 of a 3-stage flip:

| Stage | `PAYMENT_MODE` | `DEFAULT_PROTOCOL` | MPP clients | x402 clients |
|---|---|---|---|---|
| 1 | mpp | — | ✓ | 402/unknown |
| 2 (now) | multi | mpp | ✓ | ✓ via `X-PAYMENT` |
| 3 | multi | x402 | ✓ via `Authorization: Payment` | ✓ default |

MPP clients never break — they keep sending `Authorization: Payment`, detection picks MPP regardless of default. x402 clients opt in via `X-PAYMENT` or the explicit override header.

After 7 days of clean shadow traffic we flip to stage 3.

---

## Discovery

The `/openapi.json` advertises both:

\`\`\`json
{
  "info": { "x-guidance": "POST /verify ... Dual-protocol: MPP or x402 ..." },
  "x-x402": {
    "version": 1,
    "network": "base",
    "accepts": [{ "scheme": "exact", "asset": "0x833589...", ... }]
  },
  "paths": {
    "/verify": {
      "post": {
        "x-payment-info": { "protocols": ["mpp", "x402"], "price": "0.010000" }
      }
    }
  }
}
\`\`\`

Any agent SDK can pick its protocol without out-of-band knowledge. Plus there's a `/llms.txt` for LLM-driven clients that'd rather parse prose.

---

## Lessons

1. **Interface-first payment.** Protocol details belong in adapters, not handlers. The `c2pa-verify` handler is 20 lines and doesn't know USDC exists.
2. **Async settlement is a real shape of this problem.** If your `attachReceipt` is sync, you either (a) haven't settled yet, (b) have a race, or (c) block the request. Optional `settle()` is the cleanest out.
3. **Tag source for demand-signal hygiene.** Running our own seed payment to bootstrap x402 traffic would pollute "organic demand" metrics. We tag our seed wallet in `X402_SEED_PAYERS` env; settle() records `source=seed` vs `source=organic` in observability. First seed payment: [tx 0xb6c70324…](https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6).
4. **Detection must fall through on malformed input.** First draft used a `string` header parse; we'd have silently forced anyone sending `x-payment-protocol: ""` down the x402 path. Zod enum `safeParse` fixes it.

---

## What's next

- Flip stage 3 after 7 days.
- Add [CDP facilitator](https://docs.cdp.coinbase.com/) as a second facilitator once PayAI shows organic demand.
- Enrich `outputSchema.input` on our x402 PaymentRequirements so agent SDKs can auto-discover endpoint parameters.
- Apply to the [PayAI ecosystem catalog](https://payai.network/ecosystem) once we see 10+ organic payments.

Full roadmap + deferred work: [`docs/x402-roadmap.md`](https://github.com/mppfy/C2PAVerify/blob/main/docs/x402-roadmap.md).

Source: **[github.com/mppfy/C2PAVerify](https://github.com/mppfy/C2PAVerify)** (MIT).
Try it: `curl -X POST https://c2pa.mppfy.com/verify -d '{"url":"..."}'`

---

## Appendix — the interface in full

\`\`\`ts
// src/_vendor/adapters/types.ts (abridged)
export interface PaymentAdapter {
  readonly name: string;
  detects(request: Request): boolean;
  verify(req: Request, need: PaymentRequirement): Promise<PaymentVerification | null>;
  create402(need: PaymentRequirement, req: Request): Response;
  attachReceipt(resp: Response, v: PaymentVerification): Response;
  settle?(req: Request, resp: Response, v: PaymentVerification): Promise<Response>;
}
\`\`\`

That's it. The rest is two files: `mpp.ts` (~150 lines) and `x402.ts` (~200 lines). Multi-protocol is ~140 lines. Protocol detection is ~100 lines with tests covering every precedence rule.

If you're shipping a paid API for agents, this shape is worth stealing.
```

### После публикации dev.to

1. Скопируй URL опубликованной статьи
2. Reply под Twitter Post 6: `Full architecture write-up on dev.to: <URL>`
3. Добавь ссылку на dev.to в README репо (необязательно)

---

## 4. Reddit: r/LocalLLaMA (Day 2, +24h)

- **URL**: https://www.reddit.com/r/LocalLLaMA/submit
- **Link flair**: `Resources` или `Discussion` (проверь sidebar)
- **Post as link**: НЕТ (это self-post / text post)

### Title

```
Pay-per-call C2PA manifest verification — $0.01, no API key, works with agent frameworks
```

### Body

```
I shipped an HTTP API agents can discover + pay + consume without signup. Primary use: your agent downloads an image off the open web and needs to know "was this AI-generated, edited, or authentically captured?"

C2PA (the provenance standard adopted by Adobe, Microsoft, BBC, Sony, OpenAI) embeds a signed manifest in images. Normally parsing + validating the signature chain means bundling a ~15MB Rust/WASM verifier into every service. I offloaded that to one HTTP call.

**Endpoint:** https://c2pa.mppfy.com/verify
**Price:** $0.01 USDC per call
**Payment:** x402 (Base USDC, gasless for the payer) OR MPP (Tempo chain). Agent picks via request header.
**Discovery:** /openapi.json advertises both protocols; /llms.txt for LLM-driven clients.

Quick demo (curl):
```
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'x-payment-protocol: x402' \
  -d '{"url":"https://example.com/signed.jpg"}'
# → 402 with accepts:[...]  — your x402 client SDK pays and retries
```

Proof it works — first real settlement on Base mainnet: https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6

Source (MIT): https://github.com/mppfy/C2PAVerify
Uses c2pa-rs compiled to WASM under Cloudflare Workers. Full dual-protocol architecture write-up on dev.to (link in repo).

Happy to answer questions. Especially interested in what *other* provenance / authenticity / verification primitives agents would pay $0.01 for. I'm planning the next service based on real demand signal.
```

---

## 5. Reddit: r/AgenticAI или r/AI_Agents (Day 3, +48h)

- **URL (r/AgenticAI)**: https://www.reddit.com/r/AgenticAI/submit
- **URL (r/AI_Agents fallback)**: https://www.reddit.com/r/AI_Agents/submit
- **Link flair**: `Discussion`

### Title

```
Built an HTTP API for AI agents to verify content provenance — thoughts on the dual-protocol (x402 + MPP) approach?
```

### Body

```
Posting both to share what shipped and to ask a design question.

### What shipped

c2pa.mppfy.com/verify — agents POST a URL or upload a file, get back a cryptographically-validated C2PA manifest with trust-chain classification. $0.01 per call, paid via either x402 (Base USDC) or MPP (Tempo chain). No accounts, no keys, no signup.

### The design question

I implemented *both* x402 and MPP rather than picking one. Reasoning:

- x402-native agents (built with Coinbase's CDP SDK or similar) query x402 facilitator catalogs first.
- MPP-native agents hit MPPScan.
- Single-protocol = invisible to half the ecosystem for discovery purposes.

Cost of dual-protocol: ~300 lines of adapter code + a protocol-detection dispatcher. Same $0.01 price either way.

Curious if others building agent-payable APIs are making the same call, or committing to one and accepting the fragmentation. Also curious how you're measuring demand for each protocol — I'm tagging seed vs organic payments in observability to keep the demand signal clean.

Architecture write-up + code: https://github.com/mppfy/C2PAVerify
First real settlement on Base: https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6

### Bonus question for the subreddit

What's missing from the agent-payable API ecosystem right now? I'm building the *next* service based on what agents actually can't get in HTTP-with-paywall form.
```

---

## 6. Reddit: r/MachineLearning (Day 4, +72h)

- **URL**: https://www.reddit.com/r/MachineLearning/submit
- **Flair ОБЯЗАТЕЛЕН**: `[Project]` (в начале title И выбран в link flair)
- **Аудитория самая скептичная** — веди с утилитой, не с ценой

### Title

```
[Project] C2PA manifest verification as a paid HTTP API — $0.01/call, cryptographically validated against CAI trust list
```

### Body

```
**Why this is interesting for ML practitioners**

Training pipelines increasingly need provenance checks — is this image AI-generated? Was it edited after capture? Synthetic data pipelines especially need to flag SynthID-signed or C2PA-signed content to avoid recursive training artifacts.

C2PA ([spec](https://c2pa.org)) is the industry standard for signed provenance metadata, adopted by Adobe, Microsoft, BBC, Sony, Truepic, OpenAI. Validating a manifest normally requires:

1. Parsing the embedded JUMBF structure.
2. Verifying the signature chain against the [Content Authenticity Initiative](https://contentauthenticity.org) trust list (which changes — Adobe rotates their intermediate CA).
3. Classifying the trust chain as `valid` / `partial` / `unknown`.

c2pa-rs does this but it's a 15MB WASM blob to embed in every data-prep worker.

I turned the problem into an HTTP call: `POST /verify`, get the validated manifest back. Runs on Cloudflare Workers with c2pa-rs compiled in (~1.9 MB gzipped). Pay-per-call via x402 (Base USDC) or MPP (Tempo USDC) — $0.01 per verification.

**Example response:**

```
{
  "verified": true,
  "manifest": {
    "claim_generator": "Adobe Firefly 2.5",
    "signed_by": "CAI Intermediate CA",
    "assertions": [{"label": "c2pa.actions.v1", "action": "c2pa.created"}]
  },
  "trust_chain": "valid"
}
```

**Source (MIT):** https://github.com/mppfy/C2PAVerify
**Endpoint:** https://c2pa.mppfy.com/verify
**Proof of live settlement on Base:** https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6

Open to feedback on the API shape, classification taxonomy (`valid | partial | unknown`), and what other assertion types matter most for data cleaning workflows.

FAQ anticipated:
- "$0.01 is expensive at training scale" — yes; batch endpoint with N URLs per call is on the roadmap. Current pricing is for ad-hoc / online agent use.
- "Why not open-source a library?" — c2pa-rs IS open-source. This is a hosted alternative for teams that don't want the WASM bundle in their data pipeline workers.
```

---

## 7. Optional amplifiers (within Day 1-7)

### Show HN

- **URL**: https://news.ycombinator.com/submit
- **Title**: `Show HN: Pay-per-call C2PA manifest verification API — $0.01, no signup`
- **URL field**: `https://c2pa.mppfy.com`
- **Text field**: (оставь пустым или кратко 2-3 строки, HN не любит длинные Show HN)
- **Best time**: Вт/Ср 15:00-17:00 UTC
- **Первые 30 минут сиди на странице** — отвечай в комментах сразу

### PayAI Discord

- **Invite**: https://discord.gg/eWJRwMpebQ
- **Channel**: обычно `#showcase` или `#builders`
- **Message**:
  ```
  Shipped a paid API using PayAI facilitator on Base mainnet — C2PA manifest verification at $0.01/call for AI agents.
  Live: https://c2pa.mppfy.com
  First tx via your facilitator: https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6
  Source: https://github.com/mppfy/C2PAVerify
  ```

### Coinbase CDP Discord (x402 channel)

- **Invite**: через https://docs.cdp.coinbase.com/
- **Channel**: `#x402`
- **Message**:
  ```
  Built a paid API on x402 (Base mainnet, PayAI facilitator) — C2PA provenance verification for AI agents. $0.01/call.
  curl demo + 402 response body in the README: https://github.com/mppfy/C2PAVerify
  First real tx: https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6
  Curious for feedback on the dual-protocol (x402+MPP) dispatch pattern.
  ```

### Tempo / MPP Discord

Same tone, подчеркни что MPP — first-class citizen (не afterthought).

### Lobsters (только если есть invite)

- **Tags**: `api`, `crypto`
- **Title**: `Dual-protocol (x402 + MPP) paid HTTP API for C2PA manifest verification`
- **URL**: https://github.com/mppfy/C2PAVerify

---

## 8. Трекинг и engagement (после каждого поста)

### Первые 2 часа после поста

- Открой канал где запостил + refresh каждые 5-10 мин
- Отвечай на ВСЕ top-level комменты (даже "interesting" → поблагодари + добавь детали)
- `npx wrangler tail --env production` должен крутиться → скринь первые органические запросы для Twitter

### Через 24 часа после поста

Запиши в spreadsheet (или просто в блокнот):
- Upvotes / likes / retweets
- Количество комментов + качество (hostile / curious / adopter)
- GitHub stars delta
- Unique visitors на репо (GitHub Insights → Traffic)
- Хиты на `/verify` из `wrangler tail` (отфильтруй `source=organic`)

### Через 7 дней

- Если x402 organic traffic > 50 запросов → переключить `DEFAULT_PROTOCOL=x402` на prod (stage 3 rollout)
- Если < 10 запросов → не переключать, ещё 7 дней подождать
- Follow-up пост в Twitter: "1 week since launch — here's what we learned" (numbers + lessons)

---

## 9. Security — перед первым постом

Seed wallet `0x30A4E38Fc66e87F8280A74b15485603aC7145568` содержит 9.49 USDC и его PK засвечен в нашем чате. Выведи остаток перед публичным анонсом — если кто-то из читателей полезет в BaseScan, найдёт адрес, а публичный PK = публичный refill скрипт для атакующего.

**Как вывести**:
1. Открой Rabby / MetaMask → Import account → вставь PK `0xREDACTED-COMPROMISED-PK-INCIDENT-2026-04-21`
2. Base network → Send → USDC 9.49 → твой основной адрес
3. Забудь про этот адрес

---

## 10. Финальный pre-launch чек-лист

- [ ] `curl -sS -i -X POST https://c2pa.mppfy.com/verify -H 'x-payment-protocol: x402' -d '{}'` → возвращает 402 + JSON с accepts[]
- [ ] `curl -s https://c2pa.mppfy.com/openapi.json` → возвращает валидный JSON с `/verify` path
- [ ] `curl -s https://c2pa.mppfy.com/llms.txt` → возвращает текст
- [ ] https://github.com/mppfy/C2PAVerify открывается, description + 12 topics видны
- [ ] Скриншот 402 response готов для Twitter Post 3
- [ ] `wrangler tail --env production` крутится в отдельном терминале
- [ ] Seed wallet (0x30A4…) выведен на холодный адрес
- [ ] Ты залогинен в Twitter, Dev.to, Reddit, Discord под правильными аккаунтами
