#!/usr/bin/env -S npx tsx
/**
 * seed-x402-payment.ts — run a real x402 payment against our prod endpoint.
 *
 * Purpose: unlock PayAI Bazaar listing (facilitator-indexed on first real
 * payment) AND validate the full x402 stack end-to-end on mainnet. See
 * `docs/x402-roadmap.md` → "seed payment" section for rationale.
 *
 * Usage:
 *   SEED_PK=0x<64hex>... npx tsx scripts/seed-x402-payment.ts
 *
 * Optional overrides:
 *   TARGET_URL        — default https://c2pa.mppfy.com/verify
 *   TEST_IMAGE_URL    — default a publicly-hosted C2PA-signed sample
 *   DRY_RUN=1         — only fetch 402 challenge, don't actually pay
 *
 * Pre-flight:
 *   1. Create a fresh Base mainnet EOA (`viem.generatePrivateKey()` locally).
 *   2. Fund with ~$0.05 USDC on Base (need ~$0.01 for the call + buffer +
 *      ETH for gas... wait — x402 is gasless for the payer! EIP-3009
 *      authorization is signed off-chain; the facilitator pays gas. So
 *      you only need USDC, not ETH.
 *   3. Add the wallet's 0x address to `X402_SEED_PAYERS` in prod:
 *        wrangler secret put X402_SEED_PAYERS --env production
 *        (or just set as plain env var in wrangler.toml — it's not sensitive)
 *   4. Deploy so the prod Worker tags this payer as source=seed.
 *
 * Expected outcome:
 *   - HTTP 200 from /verify with a C2PA manifest in the body
 *   - `X-PAYMENT-TX-HASH` header present (Base mainnet tx hash)
 *   - `X-PAYMENT-SOURCE: seed` header (proves tagging wired)
 *   - PayAI Bazaar listing appears within 5-10 min at
 *     https://bazaar.payai.network/ (search "c2pa.mppfy.com")
 */

// Script runs under `npx tsx` (Node). Main tsconfig excludes scripts/ so
// we shim Node globals here instead of adding @types/node to the workspace.
declare const process: {
  readonly env: Record<string, string | undefined>;
  exit(code?: number): never;
};

import { createWalletClient, http, publicActions } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createPaymentHeader } from 'x402/client';
import type { PaymentRequirements } from 'x402/types';

const TARGET_URL = process.env.TARGET_URL ?? 'https://c2pa.mppfy.com/verify';
const TEST_IMAGE_URL =
  process.env.TEST_IMAGE_URL ??
  // Adobe CAI sample — known to contain a valid C2PA manifest.
  'https://spec.c2pa.org/specifications/specifications/2.0/_images/CAICAI.jpg';
const DRY_RUN = process.env.DRY_RUN === '1';
const PK = process.env.SEED_PK;

function die(msg: string): never {
  console.error(`[seed] ${msg}`);
  process.exit(1);
}

async function main() {
  if (!PK && !DRY_RUN) die('SEED_PK env var required (set DRY_RUN=1 to skip signing)');

  console.log('[seed] target:', TARGET_URL);
  console.log('[seed] image: ', TEST_IMAGE_URL);
  console.log('[seed] mode:  ', DRY_RUN ? 'dry-run (no payment)' : 'REAL payment on Base mainnet');

  // Step 1 — trigger 402 challenge.
  const challengeRes = await fetch(TARGET_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Force x402 even though default protocol on prod is MPP (stage 2).
      'x-payment-protocol': 'x402',
    },
    body: JSON.stringify({ url: TEST_IMAGE_URL }),
  });

  if (challengeRes.status !== 402) {
    const body = await challengeRes.text();
    die(`expected 402, got ${challengeRes.status}:\n${body.slice(0, 500)}`);
  }

  const challenge = (await challengeRes.json()) as {
    x402Version: number;
    error: string;
    accepts: PaymentRequirements[];
  };

  if (!challenge.accepts?.length) {
    die(`malformed 402 body — no accepts[]: ${JSON.stringify(challenge).slice(0, 500)}`);
  }

  const req = challenge.accepts[0];
  console.log('[seed] 402 challenge received:');
  console.log('       network: ', req.network);
  console.log('       asset:   ', req.asset);
  console.log('       payTo:   ', req.payTo);
  console.log('       amount:  ', req.maxAmountRequired, '(atomic USDC units)');
  console.log('       scheme:  ', req.scheme);

  if (DRY_RUN) {
    console.log('[seed] DRY_RUN=1 — stopping before signing.');
    return;
  }

  // Step 2 — sign EIP-3009 authorization.
  if (!PK) throw new Error('unreachable');
  const account = privateKeyToAccount(PK as `0x${string}`);
  console.log('[seed] signing as:', account.address);

  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  // x402 client SDK handles the EIP-3009 signing dance.
  // Cast wallet to the SDK's Signer type (shape-compatible subset).
  const paymentHeader = await createPaymentHeader(
    wallet as unknown as Parameters<typeof createPaymentHeader>[0],
    challenge.x402Version,
    req,
  );

  // Step 3 — retry with X-PAYMENT header.
  console.log('[seed] replaying request with X-PAYMENT...');
  const paidRes = await fetch(TARGET_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment-protocol': 'x402',
      'x-payment': paymentHeader,
    },
    body: JSON.stringify({ url: TEST_IMAGE_URL }),
  });

  console.log('[seed] response status:', paidRes.status);
  console.log('[seed] response headers of interest:');
  for (const name of [
    'x-payment-protocol',
    'x-payment-network',
    'x-payment-payer',
    'x-payment-amount',
    'x-payment-source',
    'x-payment-tx-hash',
    'x-payment-response',
  ]) {
    const v = paidRes.headers.get(name);
    if (v) console.log(`       ${name}: ${v}`);
  }

  if (paidRes.status === 200) {
    const body = await paidRes.json();
    console.log('[seed] body (truncated):');
    console.log(JSON.stringify(body, null, 2).slice(0, 800));
    console.log('[seed] ✓ x402 settlement completed on Base mainnet.');
    console.log('[seed] Check PayAI Bazaar in 5-10 min: https://bazaar.payai.network/');
  } else {
    const errBody = await paidRes.text();
    console.error('[seed] ✗ non-200 after payment. Body:');
    console.error(errBody.slice(0, 1000));
    process.exit(2);
  }
}

main().catch(err => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
