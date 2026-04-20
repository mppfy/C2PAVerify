/**
 * Micro-landing for mppfy.com apex.
 *
 * Served by the C2PAVerify worker when the Host header is mppfy.com (not
 * c2pa.mppfy.com — that returns the API metadata JSON from index.ts).
 *
 * Design notes:
 * - Single HTML file, inline CSS, no JS. Loads < 20 KB uncompressed.
 * - Dark terminal aesthetic to signal "this is for developers, not buyers".
 * - No analytics, no tracking pixels. Privacy-respecting by default.
 * - Cached aggressively at edge (24h) — content changes rarely.
 */

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mppfy — pay-per-call APIs for AI agents</title>
<meta name="description" content="We build HTTP APIs that AI agents can discover, pay, and consume without signup. x402 (Base USDC) + MPP (Tempo USDC). First product: C2PA Verify.">
<meta property="og:title" content="mppfy — pay-per-call APIs for AI agents">
<meta property="og:description" content="HTTP APIs for AI agents. x402 + MPP. No accounts, no keys. First product: C2PA Verify ($0.01/call).">
<meta property="og:url" content="https://mppfy.com">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
:root {
  --bg: #0a0a0a;
  --fg: #e7e7e7;
  --dim: #888;
  --accent: #7aa7ff;
  --border: #222;
  --card: #111;
  --mono: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, 'Inter', 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 720px; margin: 0 auto; padding: 80px 24px 120px; }
h1 { font-family: var(--mono); font-size: 20px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.02em; }
h2 { font-size: 13px; font-weight: 500; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; margin: 64px 0 20px; }
p { margin: 0 0 18px; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.15s; }
a:hover { border-bottom-color: var(--accent); }
code, pre { font-family: var(--mono); font-size: 14px; }
code { background: var(--card); padding: 2px 6px; border-radius: 3px; color: #f0b880; }
pre { background: var(--card); border: 1px solid var(--border); padding: 16px; border-radius: 6px; overflow-x: auto; margin: 16px 0; }
pre code { background: transparent; padding: 0; color: var(--fg); font-size: 13px; line-height: 1.6; }
.hero { display: flex; align-items: baseline; gap: 12px; margin-bottom: 40px; }
.hero .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 10px #4ade80; animation: pulse 2.5s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.tagline { font-size: 28px; font-weight: 400; margin: 24px 0 32px; letter-spacing: -0.02em; line-height: 1.25; }
.tagline .em { color: var(--accent); }
.ctas { display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0 0; }
.btn { display: inline-block; padding: 10px 18px; border-radius: 6px; font-family: var(--mono); font-size: 14px; border: 1px solid var(--border); background: var(--card); color: var(--fg); }
.btn.primary { border-color: var(--accent); color: var(--accent); }
.btn:hover { border-bottom: 1px solid; background: #161616; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; margin: 12px 0; }
.card .label { font-family: var(--mono); font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.card .title { font-size: 18px; font-weight: 500; margin: 0 0 8px; }
.card .desc { color: var(--dim); font-size: 14px; margin: 0 0 16px; }
.card .meta { font-family: var(--mono); font-size: 13px; color: var(--dim); display: flex; gap: 18px; flex-wrap: wrap; }
.card .meta a { color: var(--dim); }
.card .meta a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.badge { display: inline-block; font-family: var(--mono); font-size: 11px; padding: 3px 8px; border-radius: 3px; background: #162a16; color: #4ade80; border: 1px solid #2a4a2a; margin-left: 8px; vertical-align: middle; }
.next-list { list-style: none; padding: 0; margin: 0; font-family: var(--mono); font-size: 13px; color: var(--dim); }
.next-list li { padding: 6px 0; }
.next-list li:before { content: '· '; color: var(--accent); }
footer { margin-top: 80px; padding-top: 32px; border-top: 1px solid var(--border); font-family: var(--mono); font-size: 13px; color: var(--dim); }
footer a { color: var(--dim); margin-right: 18px; }
footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.curl { margin: 16px 0; }
</style>
</head>
<body>
<main>

<div class="hero">
  <h1>mppfy</h1>
  <span class="dot" title="live"></span>
</div>

<p class="tagline">
  Pay-per-call HTTP APIs<br>
  <span class="em">for AI agents.</span>
</p>

<p>
  We ship endpoints that agents discover, pay, and consume without
  ever signing up. Every API speaks both <a href="https://x402.org">x402</a>
  (Base USDC) and <a href="https://mpp.dev">MPP</a> (Tempo USDC) — any
  agent SDK works out of the box.
</p>

<div class="ctas">
  <a class="btn primary" href="https://c2pa.mppfy.com">Try C2PA Verify →</a>
  <a class="btn" href="https://github.com/mppfy">View on GitHub</a>
</div>

<h2>Live Products</h2>

<div class="card">
  <div class="label">HTTP API · MIT licensed</div>
  <div class="title">C2PA Verify <span class="badge">live</span></div>
  <p class="desc">
    Validate C2PA content provenance manifests against the CAI trust
    list. Signed content from Adobe, Microsoft, BBC, Sony, and
    OpenAI-compatible pipelines, classified as valid / partial /
    unknown. $0.01 USDC per call.
  </p>
  <div class="meta">
    <a href="https://c2pa.mppfy.com">c2pa.mppfy.com</a>
    <a href="https://github.com/mppfy/C2PAVerify">Source</a>
    <a href="https://c2pa.mppfy.com/openapi.json">OpenAPI</a>
    <a href="https://basescan.org/tx/0xb6c70324c605bdf9172805472c45970e2954eb27e5857701467e72f397fe17c6">First settlement</a>
  </div>
</div>

<h2>Try It</h2>

<p>Trigger the 402 challenge — no wallet required:</p>

<pre><code>curl -i -X POST https://c2pa.mppfy.com/verify \\
  -H 'x-payment-protocol: x402' \\
  -d '{"url":"https://example.com/signed.jpg"}'</code></pre>

<p>Response includes full <code>x402</code> payment requirements (Base USDC, $0.01) plus an MPP challenge. Your agent's payment SDK handles the rest.</p>

<h2>Next</h2>

<ul class="next-list">
  <li>Deepfake / AI-content scoring API</li>
  <li>Watermark detection (SynthID, C2PA soft bindings)</li>
  <li>Cross-model consensus for ambiguous content</li>
</ul>

<p style="margin-top: 20px; color: var(--dim); font-size: 14px;">
  What agent-payable API is missing from your stack?
  Ping <a href="https://x.com/mppfy_net">@mppfy_net</a> or open an
  issue on <a href="https://github.com/mppfy">GitHub</a>.
</p>

<footer>
  <a href="https://github.com/mppfy">GitHub</a>
  <a href="https://x.com/mppfy_net">X / Twitter</a>
  <a href="https://c2pa.mppfy.com/llms.txt">llms.txt</a>
  <span style="float: right;">MIT</span>
</footer>

</main>
</body>
</html>
`;

export function renderLanding(): Response {
  return new Response(LANDING_HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Edge-cache aggressively — landing content changes rarely.
      // Purge via `wrangler deployments` cache invalidation on next deploy.
      'cache-control': 'public, max-age=300, s-maxage=86400',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}
