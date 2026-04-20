// VENDOR: C2PAVerify-specific module. Not yet in mppfy/platform core.
// Extract to @mppfy/platform-core after x402 feature is merged.

/**
 * MultiProtocolAdapter — dispatch to MPP or x402 based on request signals.
 *
 * Architecture:
 * - `detectProtocol(request)` runs once per request (see detect.ts).
 * - Result is cached in a WeakMap<Request> so verify / create402 /
 *   attachReceipt all see the same protocol for the same request.
 * - `verify()` forwards to the protocol adapter's verify().
 * - `create402()` forwards to the protocol adapter's create402().
 *   Client gets exactly one protocol challenge — we don't dual-advertise,
 *   because mixed-protocol 402 bodies are ambiguous to parse.
 * - `attachReceipt()` forwards to the protocol adapter's attachReceipt().
 *
 * Why not advertise both protocols in the 402 simultaneously?
 *   The two wire formats are incompatible:
 *     - MPP → WWW-Authenticate + signed challengeId
 *     - x402 → JSON body { x402Version, error, accepts: PaymentRequirements[] }
 *   Mixing them forces every agent to implement branching on BOTH headers.
 *   Instead we pick ONE protocol per request based on the client's hint; the
 *   `/openapi.json` document advertises both so discovery-aware clients know
 *   what's available without probing.
 *
 * Observability:
 *   `PaymentVerification.metadata.detectionReason` carries the reason tag
 *   (see DetectionReason in detect.ts). wrapHandler() picks this up for
 *   Analytics Engine so rollout traffic splits are visible.
 */

import type {
  PaymentAdapter,
  PaymentRequirement,
  PaymentVerification,
} from './types';
import {
  detectProtocol,
  type DetectedProtocol,
  type DetectionResult,
  type DetectProtocolOptions,
} from './detect';

export interface MultiProtocolAdapterConfig {
  /** Protocol adapters indexed by name. Must include both 'mpp' and 'x402'. */
  readonly adapters: {
    readonly mpp: PaymentAdapter;
    readonly x402: PaymentAdapter;
  };
  /** Detection options — forwarded to detectProtocol(). */
  readonly detection: DetectProtocolOptions;
}

export function createMultiProtocolAdapter(
  config: MultiProtocolAdapterConfig,
): PaymentAdapter {
  const { adapters, detection } = config;

  // Cache detection result per request. Same request object threads through
  // verify → create402 → attachReceipt, so we only detect once.
  const detected = new WeakMap<Request, DetectionResult>();

  function resolve(request: Request): {
    adapter: PaymentAdapter;
    result: DetectionResult;
  } {
    let result = detected.get(request);
    if (!result) {
      result = detectProtocol(request, detection);
      detected.set(request, result);
    }
    const adapter = pickAdapter(adapters, result.protocol);
    return { adapter, result };
  }

  return {
    name: 'multi',

    detects(_request: Request): boolean {
      // Multi-protocol adapter is the top-level dispatcher — it always
      // "handles" the request, then delegates internally.
      return true;
    },

    async verify(
      request: Request,
      requirement: PaymentRequirement,
    ): Promise<PaymentVerification | null> {
      const { adapter, result } = resolve(request);
      const verification = await adapter.verify(request, requirement);
      if (!verification) return null;

      // Thread detection reason into metadata for observability.
      // Don't mutate — return a new object per immutability rule.
      return {
        ...verification,
        metadata: {
          ...(verification.metadata ?? {}),
          detectionReason: result.reason,
          detectedProtocol: result.protocol,
        },
      };
    },

    create402(requirement: PaymentRequirement, request: Request): Response {
      const { adapter } = resolve(request);
      return adapter.create402(requirement, request);
    },

    attachReceipt(
      response: Response,
      verification: PaymentVerification,
    ): Response {
      // We route by verification.protocol (set by child adapter in verify).
      // This is more reliable than re-running detection on the outgoing
      // response, because the Response object isn't the same identity as
      // the original Request WeakMap key.
      const adapter = pickAdapterByProtocol(adapters, verification.protocol);
      if (!adapter) {
        console.error(
          '[multi] unknown verification.protocol, skipping attachReceipt:',
          verification.protocol,
        );
        return response;
      }
      return adapter.attachReceipt(response, verification);
    },

    async settle(
      request: Request,
      response: Response,
      verification: PaymentVerification,
    ): Promise<Response> {
      const adapter = pickAdapterByProtocol(adapters, verification.protocol);
      if (!adapter || !adapter.settle) {
        // Protocol doesn't require async settlement (MPP) or unknown
        // protocol slipped through verify() — return response unchanged.
        return response;
      }
      return adapter.settle(request, response, verification);
    },
  };
}

function pickAdapter(
  adapters: MultiProtocolAdapterConfig['adapters'],
  protocol: DetectedProtocol,
): PaymentAdapter {
  return protocol === 'x402' ? adapters.x402 : adapters.mpp;
}

function pickAdapterByProtocol(
  adapters: MultiProtocolAdapterConfig['adapters'],
  protocol: string,
): PaymentAdapter | null {
  if (protocol === 'mpp') return adapters.mpp;
  if (protocol === 'x402') return adapters.x402;
  return null;
}
