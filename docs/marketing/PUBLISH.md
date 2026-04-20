# Publish playbook — C2PA Verify launch

Status: **Ready**. Prod deployed, first real x402 payment settled on Base mainnet.

## Proof artifacts (use in posts)

- **Live endpoint**: https://c2pa.mppfy.com/verify
- **Repo**: https://github.com/mppfy/C2PAVerify
- **Seed tx (proof of live payment)**: https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6
- **OpenAPI**: https://c2pa.mppfy.com/openapi.json
- **llms.txt**: https://c2pa.mppfy.com/llms.txt

## Day 1 (today)

### Step 1 — record the proof GIF (15 min)

Open terminal, run:
```bash
asciinema rec /tmp/c2pa-demo.cast
# then inside recording:
curl -i -X POST https://c2pa.mppfy.com/verify \
  -H 'x-payment-protocol: x402' \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/signed.jpg"}'
# exit with Ctrl-D
```
Or simpler: screenshot of the terminal output is fine.
- Shows: 402 status + `accepts: [...]` JSON with Base/USDC.
- Use as Twitter Post 3 attachment.

### Step 2 — Twitter/X thread

**Best posting time for dev audience**: Tue-Thu 14:00-16:00 UTC.

Copy from `docs/marketing/twitter-launch-thread.md`. 7 posts, paste sequentially.

**Before Post 1** — pin it. Before Post 3, attach the GIF/screenshot.

Tag in Post 1:
`@coinbasedev @base @CAI_Developers @PayAINetwork`

Hashtags in last post: `#x402 #AgentPayments #C2PA`.

### Step 3 — dev.to article

1. Login to https://dev.to → `Write a post`
2. Copy full body from `docs/marketing/devto-dual-protocol.md`
3. Settings:
   - Tags: `api`, `crypto`, `agents`, `cloudflare`, `typescript`
   - Canonical URL: `https://c2pa.mppfy.com`
   - Cover image: screenshot of `curl -i` showing 402 + accepts[] JSON
4. **Publish** → link back from Twitter thread as a reply to Post 6.

### Step 4 — Link devto from Twitter

Post a reply under Post 6: "Full write-up on dev.to: <link>"

---

## Day 2 (+24h) — Reddit r/LocalLLaMA

Copy `docs/marketing/reddit-posts.md` → r/LocalLLaMA section.

- Title: `Pay-per-call C2PA manifest verification — $0.01, no API key, works with agent frameworks`
- Link flair: `Resources` or `Discussion` (check subreddit sidebar)
- **Respond to every top-level comment in the first 2 hours** — Reddit ranking depends on engagement velocity.

---

## Day 3 (+48h) — Reddit r/AgenticAI (or r/AI_Agents)

Copy the r/AgenticAI section. Different angle — design question framing.

---

## Day 4 (+72h) — Reddit r/MachineLearning

- **Flair required**: `[Project]`
- Copy the r/MachineLearning section; most skeptical audience, lead with concrete utility (training data provenance).
- Be prepared for comments about cost — `$0.01/call` sounds expensive at training scale; have the answer ready: "batch via single request with multiple URLs in the body (roadmap)".

---

## Optional amplifiers (within Day 1-7)

- **HN "Show HN"**: title "Show HN: Pay-per-call C2PA manifest verification API — $0.01, no signup". Post on Tue/Wed 15:00-17:00 UTC. One paragraph. Link: `c2pa.mppfy.com`. Be ready to answer in comments within first 30 min.
- **Lobsters**: only if you have an invite. Tag `crypto`, `api`.
- **x402 Discord** (Coinbase CDP Discord `#x402`): "built a paid API on x402 — curious for feedback". One message, not an ad.
- **PayAI Discord** (https://discord.gg/eWJRwMpebQ): share the tx hash + endpoint. Their team retweets user servies.
- **MPP Discord / Tempo Discord**: same, but MPP angle.
- **Product Hunt**: skip unless you're ready for a full launch day commitment.

---

## Tracking (set up before posting)

- `wrangler tail --env production` in a terminal during Day 1 — see real traffic hit.
- D1 query for demand signal: filter `source=organic` vs `source=seed` after 48h.
- GitHub stars baseline: note the number now, compare after Day 4.

---

## Checklist before you hit "Post" anywhere

- [ ] `curl -X POST https://c2pa.mppfy.com/openapi.json | head -50` — returns valid JSON
- [ ] `curl -i -X POST https://c2pa.mppfy.com/verify -H 'x-payment-protocol: x402' -d '{}'` — returns 402 with accepts[]
- [ ] GitHub repo description + topics visible at github.com/mppfy/C2PAVerify
- [ ] Screenshot/GIF ready for Twitter Post 3
- [ ] `/tmp/c2pa-seed.jpg` test image or equivalent working for demo (multipart bypasses SSRF flake)
