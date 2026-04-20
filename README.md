# C2PAVerify

**MPP-compatible service** for verifying C2PA (Coalition for Content Provenance and Authenticity) manifests on images and media files.

- **Brand:** MPPFY
- **Service ID:** `c2pa-verify`
- **Status:** 🚧 pre-launch (W1 scaffold, implementation W2)
- **Target:** soft-launch 2026-05-24 (first public MPPFY service)
- **Endpoint:** `c2pa.mppfy.com` (after W3 deploy)
- **Payment:** MPP (Tempo chain, pay-per-call)
- **Price:** $0.01 USDC per verification *(draft, subject to W3 calibration)*

## What it does

Accepts an image/media file or URL, extracts the embedded C2PA manifest, validates the signature chain, and returns a structured verification result:

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

## Why it exists

Agents downloading media from unverified sources have no built-in way to check whether the content was AI-generated, edited, or authentically captured. The C2PA standard (adopted by Adobe, Microsoft, BBC, Sony, Truepic, OpenAI) embeds cryptographic provenance — but parsing it requires a library (`c2pa-node`, `c2patool`) and signature chain validation against a root trust list.

This service offloads that to an HTTP call.

## API

### `GET /`
Service metadata (free).

### `GET /llms.txt`
Agent-friendly service specification (free).

### `GET /health`
Health check (free).

### `POST /verify`
Verify a C2PA manifest. **Paid endpoint** — returns 402 if no valid payment.

Request:
```http
POST /verify HTTP/1.1
Authorization: Payment <mpp-credential>
Content-Type: application/json

{ "url": "https://example.com/image.jpg" }
```

Or with multipart upload:
```http
POST /verify HTTP/1.1
Authorization: Payment <mpp-credential>
Content-Type: multipart/form-data; boundary=...

<file payload>
```

Response (200): verification result JSON (see example above).
Response (402): payment challenge per MPP protocol.

## Architecture

- **Runtime:** Cloudflare Workers
- **Framework:** Hono 4.x
- **Payment SDK:** [`mppx`](https://github.com/wevm/mppx) (MPP protocol)
- **C2PA engine:** `c2pa-node` (OSS)
- **Observability:** CF Analytics Engine + D1

Code under `src/_vendor/` is copied from the shared MPPFY platform scaffold. This is temporary — it will be extracted into `@mppfy/platform-core` npm package after M6 (this service) is live. See `src/_vendor/VENDOR.md` for details.

## Development

```bash
npm install
npm run dev                   # local :8787, PAYMENT_MODE=dev (no real payments)
npm run typecheck             # tsc --noEmit
npm run deploy:staging        # wrangler deploy --env staging
```

Smoke test:
```bash
# Dev mode — no payment required
curl -s http://localhost:8787/health

# MPP mode — expect 402
PAYMENT_MODE=mpp wrangler dev
curl -v -X POST http://localhost:8787/verify -d '{"url":"https://..."}'
# → 402 WWW-Authenticate: Payment id="..." realm="..." method="tempo"
```

## Related

- MPPFY project: https://github.com/mppfy
- MPP protocol spec: https://mpp.dev
- C2PA standard: https://c2pa.org
- Service rationale: [`mpp-project/ranking/service-descriptions.md#m6`](https://github.com/mppfy/project/blob/main/ranking/service-descriptions.md) *(private repo)*

## License

MIT — see [LICENSE](./LICENSE).
