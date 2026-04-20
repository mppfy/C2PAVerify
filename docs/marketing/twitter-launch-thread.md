# Twitter / X launch thread

Goal: announce C2PA Verify with working x402 + MPP payments, route traffic to repo + API, attract agent-builders.

Target accounts to tag: `@coinbasedev`, `@base`, `@CAI_Developers`, `@adobe`, `@TruepicAI`.
Hashtags: `#x402`, `#AgentPayments`, `#C2PA`, `#ContentAuthenticity`.

---

## Thread (7 posts)

### Post 1 — hook

Launched: an agent-native C2PA manifest verification API. Pay per call — no accounts, no subscriptions, no API keys.

$0.01 USDC per verification, dual-protocol: x402 on Base (@base) or MPP on Tempo.

Live at `c2pa.mppfy.com` 👇

### Post 2 — why this exists

Agents downloading media from the open web have no built-in way to check: was this AI-generated, edited, or authentically captured?

C2PA (adopted by Adobe, Microsoft, BBC, Sony, OpenAI) embeds signed provenance. Parsing it normally means embedding a ~15 MB Rust/WASM verifier. We offload it to one HTTP call.

### Post 3 — 402 → pay → manifest demo

One curl to see the 402 challenge:

```
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'accept: application/vnd.x402+json' \
  -d '{"url":"https://example.com/signed.jpg"}'
```

→ 402 with `accepts: [{ scheme: "exact", network: "base", asset: USDC, amount: "10000" }]`

Your x402 client SDK handles the rest. [GIF / screenshot]

### Post 4 — why dual protocol

We support both x402 (@coinbasedev HTTP payment spec, Base settlement) and MPP (Tempo chain). Clients pick via `Authorization: Payment` (MPP) or `X-PAYMENT` (x402). Discovery via `/openapi.json` advertises both.

No vendor lock-in for the agent; same $0.01 price either way.

### Post 5 — the actual verification

Response shape:

```json
{
  "verified": true,
  "manifest": {
    "claim_generator": "Adobe Firefly 2.5",
    "signed_by": "CAI Intermediate CA",
    "assertions": [...]
  },
  "trust_chain": "valid"
}
```

`trust_chain` ∈ valid | partial | unknown. Uses the current CAI trust list baked into the Worker.

### Post 6 — under the hood

- Cloudflare Workers, region-less
- `c2pa-rs` compiled to WASM (~1.9 MB gzipped in the bundle)
- Verify + settle via PayAI facilitator (auto-lists in their Bazaar)
- Discovery at `/openapi.json` + `/llms.txt`

Source: github.com/mppfy/C2PAVerify (MIT)

### Post 7 — call to action

If you're building agents that ingest third-party media — try it. `curl`-level quick-start in the README.

If you'd rather pay in MPP (Tempo USDC), that's first-class too. Roadmap + deferred work in `docs/x402-roadmap.md`.

Feedback: replies or GitHub issues welcome.

---

## Shorter single-tweet fallback

> Shipped: agent-native C2PA manifest verification. Pay-per-call, $0.01 USDC, dual-protocol (x402 on Base + MPP on Tempo). No accounts, no API keys.
>
> Live: c2pa.mppfy.com
> Source: github.com/mppfy/C2PAVerify
>
> #x402 #AgentPayments #C2PA

---

## Notes for posting

- Record a 15-second terminal GIF showing the 402 → pay → 200 flow. Use `asciinema` or `terminalizer`. Attach to Post 3.
- Before posting, confirm seed payment already went through (so Bazaar listing is live when people check).
- Coinbase x402 team retweets x402 launches — tag them in Post 1.
- Avoid emoji-heavy copy; agent-focused audience prefers signal/noise tight.
