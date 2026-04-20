# C2PA Verify

**Agent-native C2PA manifest verification API.** Upload an image (or URL), get back a cryptographically-validated provenance manifest. Pay per call — no accounts, no subscriptions.

[![x402](https://img.shields.io/badge/x402-base%20usdc-0052ff)](https://x402.org)
[![MPP](https://img.shields.io/badge/MPP-tempo%20usdc-1c1c1c)](https://mpp.dev)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-cloudflare%20workers-f38020)](https://workers.cloudflare.com)
[![Status](https://img.shields.io/badge/status-live-success)](https://c2pa.mppfy.com/health)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

- **Endpoint:** `https://c2pa.mppfy.com/verify`
- **Price:** `$0.01` USDC per call
- **Protocols:** [x402](https://x402.org) (Base mainnet) · [MPP](https://mpp.dev) (Tempo mainnet)
- **Discovery:** [`/openapi.json`](https://c2pa.mppfy.com/openapi.json) · [`/llms.txt`](https://c2pa.mppfy.com/llms.txt) · PayAI Bazaar

---

## Who this is for

- **Agents** that download media from the open web and need to know: *is this AI-generated, edited, or authentic?*
- **Content pipelines** that ingest third-party images/video and must preserve provenance (newsrooms, stock platforms, moderation).
- **Developers** prototyping C2PA integrations who don't want to embed a 15MB Rust/WASM verifier in every service.

The C2PA standard ([c2pa.org](https://c2pa.org), adopted by Adobe, Microsoft, BBC, Sony, Truepic, OpenAI) embeds signed provenance metadata in images. Parsing + validating the signature chain against the Content Authenticity Initiative trust list normally requires `c2pa-rs` / `c2pa-node` and the current trust anchors. This service offloads that to one HTTP call.

---

## Quick start

### Option A — pay with x402 (Base USDC)

Works with any [x402 client SDK](https://github.com/coinbase/x402):

```ts
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.WALLET_PK as `0x${string}`),
  chain: base,
  transport: http(),
});

const pay = wrapFetchWithPayment(fetch, wallet);

const r = await pay('https://c2pa.mppfy.com/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com/signed-image.jpg' }),
});

console.log(await r.json());
```

Or manually — trigger the 402 challenge and inspect the requirements:

```bash
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'content-type: application/json' \
  -H 'accept: application/vnd.x402+json' \
  -d '{"url":"https://example.com/signed.jpg"}'

# HTTP/1.1 402 Payment Required
# content-type: application/json
# {
#   "x402Version": 1,
#   "error": "X-PAYMENT header is required",
#   "accepts": [{
#     "scheme": "exact", "network": "base",
#     "maxAmountRequired": "10000",
#     "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
#     "payTo": "0x...",
#     "resource": "https://c2pa.mppfy.com/verify",
#     "extra": { "name": "USD Coin", "version": "2" }
#   }]
# }
```

### Option B — pay with MPP (Tempo USDC)

```bash
# 1. Ask for a challenge
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/signed.jpg"}'
# → 402 WWW-Authenticate: Payment id="..." realm="c2pa.mppfy.com" method="tempo"

# 2. Pay the challenge with mppx SDK, then retry with Authorization: Payment <cred>
```

See [`mpp.dev`](https://mpp.dev) for the mppx SDK.

### Which protocol gets picked?

Detection (in order):
1. `x-payment-protocol: mpp|x402` — explicit override wins over everything.
2. `Authorization: Payment <cred>` → MPP.
3. `X-PAYMENT: <base64>` → x402.
4. `Accept: application/vnd.(mpp|x402)+json` → soft hint.
5. Default: `mpp` (will flip to `x402` after 7 days of clean shadow traffic — see [`docs/x402-roadmap.md`](./docs/x402-roadmap.md)).

---

## Response shape

```json
{
  "verified": true,
  "manifest": {
    "claim_generator": "Adobe Firefly 2.5",
    "signed_by": "Content Authenticity Initiative Intermediate CA",
    "signed_at": "2026-04-15T14:22:10Z",
    "assertions": [
      { "label": "c2pa.actions.v1", "action": "c2pa.created" },
      { "label": "stds.iptc.photo-metadata" }
    ]
  },
  "trust_chain": "valid",
  "warnings": []
}
```

`trust_chain` ∈ `"valid" | "partial" | "unknown"`. `partial` means the chain validates but a leaf cert is outside the trust list (still useful for provenance, weaker guarantee).

---

## Endpoints

| Route | Auth | Price | Purpose |
|---|---|---|---|
| `GET /` | — | free | Service metadata + endpoint index |
| `GET /llms.txt` | — | free | Agent-readable service spec |
| `GET /openapi.json` | — | free | OpenAPI 3.1 + x402 `accepts` block |
| `GET /health` | — | free | Liveness probe |
| `POST /verify` | x402 or MPP | **$0.01** | Verify a C2PA manifest |

**Upload:** `multipart/form-data` with a single file field (≤25 MB), image/video/audio.
**URL mode:** JSON body `{ "url": "https://..." }`, we fetch + verify server-side.

---

## Architecture

- **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com) (single region-less deployment).
- **Framework:** [Hono](https://hono.dev) 4.x.
- **C2PA engine:** `c2pa-rs` compiled to WASM (7.5 MB raw, ~1.9 MB gzipped), embedded trust list.
- **x402 SDK:** [`x402`](https://github.com/coinbase/x402) + [`x402/verify`](https://github.com/coinbase/x402) via [PayAI facilitator](https://facilitator.payai.network).
- **MPP SDK:** [`mppx`](https://github.com/wevm/mppx) (Tempo chain).
- **Observability:** CF Analytics Engine + D1.

Source tree:
```
src/
  index.ts                   # Hono routes + openapi + llms.txt
  c2pa/                      # WASM loader + trust list artifacts
  _vendor/adapters/
    detect.ts                # protocol detection (pure function)
    multi.ts                 # dispatcher (routes verify/402/receipt)
    mpp.ts                   # MPP adapter
    x402.ts                  # x402 adapter
    x402-facilitator.ts      # facilitator client (PayAI on prod)
docs/
  x402-roadmap.md            # deferred work: CDP pool, stage 3, schema enrichment
```

Code under `src/_vendor/` is shared MPPFY platform scaffold, scheduled for extraction into `@mppfy/platform-core` after M6. See `src/_vendor/VENDOR.md`.

---

## Development

```bash
npm install
npm run dev                   # local :8787, PAYMENT_MODE=dev (no real payments)
npm run typecheck             # tsc --noEmit
npm test                      # vitest (detect, multi, x402-requirements)
npm run deploy:staging        # wrangler deploy --env staging
npm run deploy:production     # requires confirmation
```

Local smoke test:
```bash
# Dev mode — no payment required
curl -s http://localhost:8787/health

# Multi-protocol — expect 402 (MPP by default)
PAYMENT_MODE=multi wrangler dev
curl -v -X POST http://localhost:8787/verify -d '{"url":"https://..."}'
# → 402 WWW-Authenticate: Payment ...

# Force x402 challenge on same endpoint
curl -v -X POST http://localhost:8787/verify \
  -H 'x-payment-protocol: x402' \
  -d '{"url":"https://..."}'
# → 402 application/json with x402 accepts[]
```

---

## Discovery & agent integration

- **OpenAPI:** [`c2pa.mppfy.com/openapi.json`](https://c2pa.mppfy.com/openapi.json) exposes both `x-payment-info` (MPP) and top-level `x-x402.accepts[]` (x402) so any agent SDK can pick its protocol without out-of-band knowledge.
- **llms.txt:** [`c2pa.mppfy.com/llms.txt`](https://c2pa.mppfy.com/llms.txt) — short prose spec for LLM-driven clients.
- **PayAI Bazaar:** auto-listed on first real x402 payment through prod.
- **MPPScan:** listed via MPP discovery.

---

## Related

- **MPP protocol:** https://mpp.dev
- **x402 protocol:** https://x402.org · [Coinbase repo](https://github.com/coinbase/x402)
- **C2PA standard:** https://c2pa.org · [c2pa-rs](https://github.com/contentauth/c2pa-rs)
- **Content Authenticity Initiative:** https://contentauthenticity.org
- **MPPFY services:** https://github.com/mppfy
- **Roadmap:** [`docs/x402-roadmap.md`](./docs/x402-roadmap.md)

## License

MIT — see [LICENSE](./LICENSE).
