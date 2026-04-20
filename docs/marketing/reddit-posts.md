# Reddit launch posts

Three drafts tailored to each subreddit's vibe. Don't cross-post verbatim — mods dislike that.

---

## r/LocalLLaMA

**Title:** Pay-per-call C2PA manifest verification — $0.01, no API key, works with agent frameworks

**Body:**

I shipped an HTTP API agents can discover + pay + consume without signup. Primary use: your agent downloads an image off the open web and needs to know "was this AI-generated, edited, or authentically captured?"

C2PA (the provenance standard adopted by Adobe, Microsoft, BBC, Sony, OpenAI) embeds a signed manifest in images. Normally parsing + validating the signature chain means bundling a ~15MB Rust/WASM verifier into every service. I offloaded that to one HTTP call.

**Endpoint:** `https://c2pa.mppfy.com/verify`
**Price:** $0.01 USDC per call
**Payment:** x402 (Base USDC, gasless for the payer) OR MPP (Tempo chain). Agent picks via request header.
**Discovery:** `/openapi.json` advertises both protocols; `/llms.txt` for LLM-driven clients.

Quick demo (curl):
```
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'accept: application/vnd.x402+json' \
  -d '{"url":"https://example.com/signed.jpg"}'
# → 402 with accepts:[...]  — your x402 client SDK pays and retries
```

Source (MIT): https://github.com/mppfy/C2PAVerify
Uses `c2pa-rs` compiled to WASM under Cloudflare Workers. Full dual-protocol architecture write-up on dev.to (link in repo).

Happy to answer questions. Especially interested in what *other* provenance / authenticity / verification primitives agents would pay $0.01 for. I'm planning the next service based on real demand signal.

---

## r/AgenticAI (or r/AI_Agents)

**Title:** Built an HTTP API for AI agents to verify content provenance — thoughts on the dual-protocol (x402 + MPP) approach?

**Body:**

Posting both to share what shipped and to ask a design question.

### What shipped

`c2pa.mppfy.com/verify` — agents POST a URL or upload a file, get back a cryptographically-validated C2PA manifest with trust-chain classification. $0.01 per call, paid via either x402 (Base USDC) or MPP (Tempo chain). No accounts, no keys, no signup.

### The design question

I implemented *both* x402 and MPP rather than picking one. Reasoning:

- x402-native agents (built with Coinbase's CDP SDK or similar) query x402 facilitator catalogs first.
- MPP-native agents hit MPPScan.
- Single-protocol = invisible to half the ecosystem for discovery purposes.

Cost of dual-protocol: ~300 lines of adapter code + a protocol-detection dispatcher. Same `$0.01` price either way.

Curious if others building agent-payable APIs are making the same call, or committing to one and accepting the fragmentation. Also curious how you're measuring demand for each protocol — I'm tagging seed vs organic payments in observability to keep the demand signal clean.

Architecture write-up + code: https://github.com/mppfy/C2PAVerify

### Bonus question for the subreddit

What's missing from the agent-payable API ecosystem right now? I'm building the *next* service based on what agents actually can't get in HTTP-with-paywall form.

---

## r/MachineLearning

**Title:** [Project] C2PA manifest verification as a paid HTTP API — $0.01/call, cryptographically validated against CAI trust list

**Body:**

**Why this is interesting for ML practitioners**

Training pipelines increasingly need provenance checks — is this image AI-generated? Was it edited after capture? Synthetic data pipelines especially need to flag SynthID-signed or C2PA-signed content to avoid recursive training artifacts.

C2PA ([spec](https://c2pa.org)) is the industry standard for signed provenance metadata, adopted by Adobe, Microsoft, BBC, Sony, Truepic, OpenAI. Validating a manifest normally requires:

1. Parsing the embedded JUMBF structure.
2. Verifying the signature chain against the [Content Authenticity Initiative](https://contentauthenticity.org) trust list (which changes — Adobe rotates their intermediate CA).
3. Classifying the trust chain as `valid` / `partial` / `unknown`.

`c2pa-rs` does this but it's a 15MB WASM blob to embed in every data-prep worker.

I turned the problem into an HTTP call: `POST /verify`, get the validated manifest back. Runs on Cloudflare Workers with `c2pa-rs` compiled in (~1.9 MB gzipped). Pay-per-call via x402 (Base USDC) or MPP (Tempo USDC) — $0.01 per verification.

**Example response:**

```json
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

Open to feedback on the API shape, classification taxonomy (`valid | partial | unknown`), and what other assertion types matter most for data cleaning workflows.

---

## Posting notes

- **Do not** post all three the same day. Reddit treats that as spam. Space them across 3-4 days.
- **Order matters:** r/LocalLLaMA first (most friendly to crypto-payment-for-API angles), then r/AgenticAI, r/MachineLearning last (most skeptical, come with proof).
- **Check subreddit rules** for "self-promotion ratio" — r/MachineLearning has a `[Project]` flair requirement.
- **Wait to post** until:
  1. Seed payment went through (so PayAI Bazaar listing exists to link).
  2. GitHub metadata + README are live (users will land on repo first).
- **Respond to every top-level comment in the first 2 hours.** Reddit ranking depends on engagement velocity.
