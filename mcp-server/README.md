# @mppfy/c2pa-verify-mcp

**MCP server** exposing [c2pa.mppfy.com/verify](https://c2pa.mppfy.com) as a tool your AI agent can call directly. Pays automatically via [x402](https://x402.org) on Base (USDC), no subscription.

## What this does

Agents (Claude Desktop, Cline, Cursor, Continue, Windsurf — anything speaking [MCP](https://modelcontextprotocol.io)) gain a `verify_c2pa_manifest` tool. The agent passes an image URL; the MCP server pays $0.01 USDC on the user's behalf, hits the API, returns the verified manifest.

```
Agent:  "Verify this image: https://example.com/signed.jpg"
Tool → verify_c2pa_manifest({ url: "https://example.com/signed.jpg" })
  ← { verified: true, manifest: {...}, trust_chain: "valid", _payment: { tx_hash: "0x..." } }
Agent:  "Yes — signed by Adobe Firefly 2.5, trust chain valid."
```

## Install

```bash
npm install -g @mppfy/c2pa-verify-mcp
```

Or run without installing:

```bash
npx @mppfy/c2pa-verify-mcp
```

## Configure your MCP host

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "c2pa-verify": {
      "command": "npx",
      "args": ["@mppfy/c2pa-verify-mcp"],
      "env": {
        "C2PA_VERIFY_WALLET_PK": "0xYOUR_BASE_MAINNET_PRIVATE_KEY"
      }
    }
  }
}
```

Restart Claude Desktop. The `verify_c2pa_manifest` tool appears in the tool list.

### Cline / Cursor / Continue

Same pattern in each host's MCP config section. Consult their docs for the exact config file location.

## Prerequisites

- **Node ≥ 20**
- **Base mainnet EOA** with USDC loaded (ideally ≥$0.10 to cover a handful of calls). No ETH needed — x402 is gasless for the payer; the facilitator covers gas.
- Private key held locally (never leaves your machine — the MCP server runs in your own process).

### Funding a wallet

1. Generate a fresh EOA (recommended — don't reuse an existing wallet holding other funds):
   ```bash
   node -e "const {generatePrivateKey}=require('viem/accounts');console.log(generatePrivateKey())"
   ```
2. Bridge ~$0.10 USDC to Base mainnet: Coinbase on-ramp, [Circle CCTP](https://www.circle.com/en/cross-chain-transfer-protocol), or any EVM bridge.
3. Paste the private key into the MCP host env (`C2PA_VERIFY_WALLET_PK`).

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `C2PA_VERIFY_WALLET_PK` | ✓ | — | 0x-prefixed EVM private key (Base mainnet). |
| `C2PA_VERIFY_ENDPOINT` | | `https://c2pa.mppfy.com/verify` | Override for testing against staging. |
| `C2PA_VERIFY_MAX_ATOMIC` | | `20000` | Per-call spend cap in USDC atomic units (20000 = $0.02). |

The per-call cap is a safety rail: if the facilitator ever asks for more than the cap, the server refuses to sign. Service is priced at $0.01 (= 10000 atomic), so the default 20000 gives 2× headroom.

## Security notes

- **Private key never leaves your machine.** The MCP server runs in your host process (stdio transport). No cloud component sees it.
- **Hard spend cap.** Configurable per-call USDC ceiling — a compromised upstream can't overcharge.
- **Network pinning.** Server refuses to sign if the facilitator asks for a chain other than `base`.
- **Fresh wallet recommended.** Don't point at a wallet holding unrelated funds — x402 gives the facilitator permission to move `maxAmountRequired` USDC per authorization.

## Troubleshooting

**Tool call returns `C2PA_VERIFY_WALLET_PK env var is required`**
Your MCP host didn't forward env vars. Check the `env: {}` block in the host config.

**Tool call returns `Facilitator requested network=base-sepolia, expected=base`**
You're pointing at the staging endpoint. Unset `C2PA_VERIFY_ENDPOINT`.

**Tool call succeeds but `_payment.tx_hash` is missing**
The HTTP call completed without on-chain settlement (possible facilitator outage). The manifest response is still valid; payment may retry automatically next call. Check `https://c2pa.mppfy.com/health`.

## Development

```bash
cd mcp-server
npm install
npm run dev   # tsx watch
```

Test against the real API:
```bash
C2PA_VERIFY_WALLET_PK=0x... npx tsx src/index.ts
# Then drive the stdio protocol manually or connect from Claude Desktop
# with `"command": "npx", "args": ["tsx", "<abs-path>/src/index.ts"]`.
```

## License

MIT.
