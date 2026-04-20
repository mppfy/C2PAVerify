/**
 * Thin x402 payment helper — issues a POST, handles 402 + retry-with-payment.
 *
 * Isolated from the MCP glue so we can unit-test the payment dance
 * independently. Keeps the MCP server file focused on protocol/tool schema.
 */

import { createWalletClient, http, publicActions } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createPaymentHeader } from 'x402/client';
import type { PaymentRequirements } from 'x402/types';

export interface PaidRequestOptions {
  url: string;
  body: unknown;
  /** EVM private key hex (0x-prefixed) — user's Base mainnet wallet. */
  privateKey: `0x${string}`;
  /** Hard cap so a malformed 402 can't drain the user's wallet. Atomic units. */
  maxAmountAtomic?: string;
  /** Network check — abort if facilitator asks for a different chain. */
  expectedNetwork?: 'base' | 'base-sepolia';
}

export interface PaidRequestResult {
  status: number;
  body: unknown;
  txHash?: string;
  payer?: string;
  amountPaid?: string;
}

/**
 * POST to `url` with `body` as JSON. If the server returns 402, sign the
 * requirements with `privateKey` and retry once. Throws on any other failure.
 */
export async function postPaidJson(opts: PaidRequestOptions): Promise<PaidRequestResult> {
  // 1. Initial unpaid request — ask for the challenge.
  const initial = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment-protocol': 'x402',
    },
    body: JSON.stringify(opts.body),
  });

  // Pass-through success (e.g. future free tier).
  if (initial.status !== 402) {
    return {
      status: initial.status,
      body: await parseMaybeJson(initial),
    };
  }

  const challenge = (await initial.json()) as {
    x402Version: number;
    error?: string;
    accepts: PaymentRequirements[];
  };

  if (!challenge.accepts?.length) {
    throw new Error(`Malformed 402 response: no accepts[] (error=${challenge.error ?? 'none'})`);
  }

  const req = challenge.accepts[0];

  if (opts.expectedNetwork && req.network !== opts.expectedNetwork) {
    throw new Error(
      `Facilitator requested network=${req.network}, expected=${opts.expectedNetwork}. ` +
        `Refusing to sign (could be a spoofed endpoint).`,
    );
  }

  if (opts.maxAmountAtomic) {
    const max = BigInt(opts.maxAmountAtomic);
    const ask = BigInt(req.maxAmountRequired);
    if (ask > max) {
      throw new Error(
        `Facilitator asked for ${req.maxAmountRequired} atomic units, cap is ${opts.maxAmountAtomic}. Aborting.`,
      );
    }
  }

  // 2. Sign the EIP-3009 authorization.
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  const paymentHeader = await createPaymentHeader(
    wallet as unknown as Parameters<typeof createPaymentHeader>[0],
    challenge.x402Version,
    req,
  );

  // 3. Retry with the payment header.
  const paid = await fetch(opts.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment-protocol': 'x402',
      'x-payment': paymentHeader,
    },
    body: JSON.stringify(opts.body),
  });

  const result: PaidRequestResult = {
    status: paid.status,
    body: await parseMaybeJson(paid),
  };
  const txHash = paid.headers.get('x-payment-tx-hash');
  const payer = paid.headers.get('x-payment-payer');
  const amount = paid.headers.get('x-payment-amount');
  if (txHash) result.txHash = txHash;
  if (payer) result.payer = payer;
  if (amount) result.amountPaid = amount;
  return result;
}

async function parseMaybeJson(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return { error: 'malformed-json-body' };
    }
  }
  return await res.text();
}
