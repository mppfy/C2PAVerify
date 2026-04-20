# How we shipped a dual-protocol (x402 + MPP) paid API in a weekend

**Tags:** `#api` `#crypto` `#agents` `#cloudflare` `#typescript`
**Canonical URL:** https://c2pa.mppfy.com
**Cover image suggestion:** terminal screenshot of `curl -i` showing 402 + JSON accepts[]

---

## The problem

We wanted to ship a pay-per-call API for C2PA manifest verification — the kind of service an AI agent should be able to discover, pay, and consume without a human ever signing up. Two payment protocols fit the brief:

- **[x402](https://x402.org)** — Coinbase's HTTP-native payment spec. USDC on Base. Agent signs an [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009) authorization; facilitator broadcasts.
- **[MPP](https://mpp.dev)** — Machine Payments Protocol. USDC on Tempo chain. Agent signs a challenge; we settle on-chain.

Picking *one* felt like betting on the wrong horse. Agent ecosystems fragment around which protocol they "speak" first — x402-native clients query x402 facilitator catalogs; MPP-native clients hit MPPScan. A single-protocol API means invisibility to half the audience.

So: both. But how without shoving protocol details into every endpoint?

---

## The architecture

One `PaymentAdapter` interface. Both protocols implement it. A thin `MultiProtocolAdapter` dispatches based on request signals.

```ts
interface PaymentAdapter {
  readonly name: string;
  detects(request: Request): boolean;
  verify(request: Request, req: PaymentRequirement): Promise<PaymentVerification | null>;
  create402(req: PaymentRequirement, request: Request): Response;
  attachReceipt(response: Response, verification: PaymentVerification): Response;
  settle?(request: Request, response: Response, verification: PaymentVerification): Promise<Response>;
}
```

The handler never imports `x402/verify` or `mppx`. It just asks the adapter: "is this request paid?" and "build me the 402 challenge."

### Protocol detection (pure function, easy to test)

```ts
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
```

Zod enum parsing on the header means malformed input (`x-payment-protocol: bitcoin`) falls through to the next precedence step instead of throwing. The reason tag gets written to analytics — we can see *why* every request got routed the way it did.

### Sync verify, async settle

A gotcha: x402 requires an **async** facilitator call at settlement time (to broadcast the EIP-3009 auth). But `attachReceipt()` is sync — it just adds headers. We'd originally wired x402 with no settle call, so payments verified but USDC never moved. Silent bug because we had no organic traffic yet.

Fix: add an optional `settle()` to the interface. MPP doesn't need it. x402 implements it. Dispatcher forwards by `verification.protocol`.

```ts
// in /verify handler
let response = await c2paVerify.handler(c);
response = adapter.attachReceipt(response, verification);
if (adapter.settle) {
  response = await adapter.settle(c.req.raw, response, verification);
}
return response;
```

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

```json
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
```

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

```ts
// src/_vendor/adapters/types.ts (abridged)
export interface PaymentAdapter {
  readonly name: string;
  detects(request: Request): boolean;
  verify(req: Request, need: PaymentRequirement): Promise<PaymentVerification | null>;
  create402(need: PaymentRequirement, req: Request): Response;
  attachReceipt(resp: Response, v: PaymentVerification): Response;
  settle?(req: Request, resp: Response, v: PaymentVerification): Promise<Response>;
}
```

That's it. The rest is two files: `mpp.ts` (~150 lines) and `x402.ts` (~200 lines). Multi-protocol is ~140 lines. Protocol detection is ~100 lines with tests covering every precedence rule.

If you're shipping a paid API for agents, this shape is worth stealing.
