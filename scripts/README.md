# scripts/

Operational scripts not part of the runtime. Run from the repo root.

## `seed-x402-payment.ts`

Triggers one real x402 payment against prod `/verify` to:
1. Unlock the PayAI Bazaar listing (facilitator catalogs on first real payment).
2. End-to-end validate the x402 stack (402 → sign → X-PAYMENT → settle → tx hash).

### Prerequisites

1. A Base mainnet EOA funded with ~$0.05 USDC (no ETH needed — x402 is
   gasless for the payer; facilitator pays gas).
2. The wallet's `0x...` address set in prod env `X402_SEED_PAYERS` so the
   adapter tags this payment as `source=seed` in observability (keeps
   demand metrics clean).
3. `npx tsx` available (installed transitively via wrangler/vitest).

### Dry run first

Verify the 402 shape comes back correctly before burning USDC:

```bash
DRY_RUN=1 npx tsx scripts/seed-x402-payment.ts
```

### Real run

```bash
# One-time: add seed wallet to prod config
# (edit wrangler.toml: X402_SEED_PAYERS = "0xYourSeedWallet")
npm run deploy:production

# Fund the wallet with ~$0.05 USDC on Base mainnet
# (any wallet UI, Circle CCTP, or bridge)

# Run the seed payment
SEED_PK=0xYourSeedPrivateKey npx tsx scripts/seed-x402-payment.ts
```

### Expected output

```
[seed] target: https://c2pa.mppfy.com/verify
[seed] 402 challenge received: network=base amount=10000 ...
[seed] signing as: 0x...
[seed] replaying request with X-PAYMENT...
[seed] response status: 200
[seed]   x-payment-tx-hash: 0x...
[seed]   x-payment-source: seed
[seed] ✓ x402 settlement completed on Base mainnet.
[seed] Check PayAI Bazaar in 5-10 min: https://bazaar.payai.network/
```

### Rollback

If the payment succeeds but something looks wrong, USDC is already moved
— the transfer isn't reversible. Operational cost is ~$0.01, treat as sunk.

If the script fails mid-way (e.g. signing error), no on-chain action
occurred. Safe to re-run after fixing.
