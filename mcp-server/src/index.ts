#!/usr/bin/env node
/**
 * @mppfy/c2pa-verify-mcp — MCP server exposing c2pa.mppfy.com/verify
 * as a tool that agents (Claude Desktop, Cline, Cursor, Continue, etc.)
 * can call directly.
 *
 * Transport: stdio (single process, launched by the MCP host).
 *
 * Auth: agents pay via a user-provided Base mainnet wallet loaded from env:
 *   C2PA_VERIFY_WALLET_PK   — 0x-prefixed EVM private key (required)
 *   C2PA_VERIFY_ENDPOINT    — override default https://c2pa.mppfy.com/verify
 *   C2PA_VERIFY_MAX_ATOMIC  — spend cap in atomic USDC units (default 20000 = $0.02)
 *
 * Tool: `verify_c2pa_manifest`
 *   input: { url: string (http[s]://...) }
 *   output: { verified, manifest, trust_chain, warnings, tx_hash, ... }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { postPaidJson } from './pay.js';

const DEFAULT_ENDPOINT = 'https://c2pa.mppfy.com/verify';
const DEFAULT_MAX_ATOMIC = '20000'; // $0.02 cap — service is $0.01, leaves slack.

const VerifyInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine(u => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'url must be http(s)',
    })
    .describe('Publicly-fetchable URL of an image/video/audio file to verify.'),
});

const PkSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x-prefixed 64-hex EVM private key');

type VerifyInput = z.infer<typeof VerifyInputSchema>;

function requirePk(): `0x${string}` {
  const raw = process.env.C2PA_VERIFY_WALLET_PK;
  if (!raw) {
    throw new Error(
      'C2PA_VERIFY_WALLET_PK env var is required — set to a 0x... Base mainnet private key with ≥$0.02 USDC.',
    );
  }
  const parsed = PkSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`C2PA_VERIFY_WALLET_PK invalid: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data as `0x${string}`;
}

async function handleVerify(args: VerifyInput): Promise<unknown> {
  const privateKey = requirePk();
  const endpoint = process.env.C2PA_VERIFY_ENDPOINT ?? DEFAULT_ENDPOINT;
  const maxAmountAtomic = process.env.C2PA_VERIFY_MAX_ATOMIC ?? DEFAULT_MAX_ATOMIC;

  const r = await postPaidJson({
    url: endpoint,
    body: { url: args.url },
    privateKey,
    maxAmountAtomic,
    expectedNetwork: 'base',
  });

  if (r.status !== 200) {
    return {
      error: `upstream status ${r.status}`,
      body: r.body,
    };
  }

  return {
    ...(typeof r.body === 'object' && r.body !== null ? r.body : { body: r.body }),
    _payment: {
      tx_hash: r.txHash,
      payer: r.payer,
      amount_atomic_usdc: r.amountPaid,
      network: 'base',
    },
  };
}

async function main() {
  const server = new Server(
    { name: 'c2pa-verify-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'verify_c2pa_manifest',
        description:
          'Verify the C2PA content-provenance manifest on a publicly-hosted image/video/audio file. ' +
          'Returns manifest details (claim_generator, signed_by, assertions) and trust_chain classification ' +
          '(valid | partial | unknown). Costs ~$0.01 USDC per call, paid automatically via x402 on Base.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'HTTPS URL of the media file to verify.',
            },
          },
          required: ['url'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name !== 'verify_c2pa_manifest') {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }

    const parsed = VerifyInputSchema.safeParse(request.params.arguments);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid arguments: ${parsed.error.issues.map(i => i.message).join('; ')}`,
          },
        ],
      };
    }

    try {
      const result = await handleVerify(parsed.data);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `verify_c2pa_manifest failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep-alive: MCP stdio servers run until the host closes stdin.
  // Log once to stderr so debugging in Claude Desktop shows server started.
  process.stderr.write('[c2pa-verify-mcp] ready\n');
}

main().catch(err => {
  process.stderr.write(`[c2pa-verify-mcp] fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
