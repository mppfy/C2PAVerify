/**
 * C2PA verification pipeline.
 *
 * Принимает Blob (image/video) → прогоняет через WasmReader c2pa-wasm →
 * возвращает structured result per README schema.
 *
 * Подход:
 *   - WasmReader.fromBlob(format, blob) — парсит manifest + validates signature
 *   - manifestStore() — full object с claim_generator, assertions, signature info
 *   - На ошибке "no manifest found" → { verified: false, error: 'no_c2pa_manifest' }
 *
 * NOTE: W2 scope = extraction + basic signature check (c2pa-rs default).
 * Full trust-anchor validation против CAI trust list = W3 (нужен embed trust list в KV).
 */

import { ensureC2paReady } from './wasm-loader';
import { registerBlobBytes } from './filereader-polyfill';

export interface VerifyResult {
  verified: boolean;
  manifest?: {
    claim_generator?: string;
    signed_by?: string;
    signed_at?: string;
    assertions?: Array<{ label: string }>; // labels only — full assertion payloads могут содержать PII (EXIF GPS, etc.)
    title?: string;
    format?: string;
  };
  trust_chain?: 'valid' | 'partial' | 'unknown';
  /**
   * Stable machine-readable validation codes from c2pa-rs (e.g. 'signingCredential.untrusted').
   * Не exposes raw explanation strings — тем могут содержать internal paths / OIDs.
   */
  warnings?: string[];
}

export interface VerifyError {
  error: string;
  reason?: string;
}

export type VerifyOutcome =
  | { ok: true; result: VerifyResult }
  | { ok: false; status: 422 | 415 | 500; error: VerifyError };

/**
 * Extract + verify C2PA manifest from a Blob.
 *
 * Returns discriminated union — caller picks HTTP status.
 */
export async function verifyC2PA(blob: Blob): Promise<VerifyOutcome> {
  if (blob.size === 0) {
    return {
      ok: false,
      status: 422,
      error: { error: 'empty_file', reason: 'Uploaded file is empty' },
    };
  }

  const format = blob.type || 'application/octet-stream';
  // c2pa-rs требует format hint типа "image/jpeg", "image/png", "video/mp4"...
  if (!isSupportedFormat(format)) {
    return {
      ok: false,
      status: 415,
      error: {
        error: 'unsupported_format',
        reason: `C2PA verification not supported for ${format}`,
      },
    };
  }

  const c2pa = await ensureC2paReady();

  // Pre-buffer blob bytes so FileReaderSync polyfill can serve synchronous reads
  // when c2pa-rs internally slices the blob. MUST happen before fromBlob.
  const bufferedBlob = await registerBlobBytes(blob);

  let reader;
  try {
    reader = await c2pa.WasmReader.fromBlob(format, bufferedBlob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // c2pa-rs throws various messages when asset has no embedded manifest:
    //  - "No claim found" / "No manifest"
    //  - "jumbf not found"
    //  - InvalidAsset("PNG out of range") — valid PNG without C2PA chunk
    //  - InvalidAsset("JPEG out of range") — valid JPEG without C2PA APP11
    //  - "ProvenanceMissing" / "MissingJumbf"
    // NOTE: регex anchored к известным c2pa-rs variant'ам — bare "out of range"
    // слишком широкий (может match'нуть memory-panic от corrupt file).
    const noManifest =
      /no[- _]?claim|no[- _]?manifest|jumbf[- _]?not[- _]?found|provenance[- _]?missing|missing[- _]?jumbf|(PNG|JPEG|GIF|TIFF|MP4|MOV|WEBP|HEIC|AVIF) out of range/i;
    if (noManifest.test(msg)) {
      return {
        ok: false,
        status: 422,
        error: {
          error: 'no_c2pa_manifest',
          reason: 'File contains no embedded C2PA manifest',
        },
      };
    }
    // Full message in server logs only — client gets generic reason (avoid leaking
    // Rust panic traces, internal paths, или c2pa-rs internals).
    console.error('[c2pa] WasmReader.fromBlob failed:', msg);
    return {
      ok: false,
      status: 500,
      error: {
        error: 'c2pa_parse_failed',
        reason: 'Failed to parse C2PA manifest from uploaded asset.',
      },
    };
  }

  try {
    const manifestStore = reader.manifestStore() as {
      active_manifest?: string;
      manifests?: Record<string, unknown>;
      validation_status?: Array<{ code: string; explanation?: string }>;
    };

    const activeLabel = reader.activeLabel();
    const active =
      activeLabel && manifestStore.manifests?.[activeLabel]
        ? (manifestStore.manifests[activeLabel] as Record<string, unknown>)
        : undefined;

    // Classify validation statuses into three buckets:
    //   - success  (contains ".validated" or "signingCredential.trusted")
    //   - trustOnly ("signingCredential.untrusted") — expected в W2 без CAI trust list
    //   - failures — всё остальное → блокирует verified: true
    //
    // W2 policy: verified = signature math валид + manifest extracted. Trust anchors
    // (W3) отдельно surface'им через trust_chain: 'valid' | 'partial' | 'unknown'.
    const validationStatuses = manifestStore.validation_status ?? [];
    const trustOnlyCode = /^signingCredential\.(untrusted|unknown)$/i;
    const successCode = /\.(validated|trusted)$/i;

    const failures = validationStatuses.filter(
      v => !successCode.test(v.code) && !trustOnlyCode.test(v.code),
    );
    const trustWarnings = validationStatuses.filter(v => trustOnlyCode.test(v.code));

    // Exposing only stable machine codes (e.g. "signingCredential.untrusted"),
    // не raw explanation — v.explanation может содержать OID строки, internal
    // paths или debug info из c2pa-rs.
    const warnings = [
      ...failures.map(v => v.code),
      ...trustWarnings.map(v => v.code),
    ];

    const verified = failures.length === 0;
    const trustChain: 'valid' | 'partial' | 'unknown' =
      failures.length > 0
        ? 'unknown'
        : trustWarnings.length > 0
          ? 'partial'
          : 'valid';

    const signatureInfo = active?.signature_info as
      | { issuer?: string; time?: string }
      | undefined;

    // Strip assertion payloads — оставляем только labels. Полный assertion содержит
    // потенциально чувствительные данные (EXIF GPS, thumbnails с metadata).
    // Consumer who needs full payload должен fetch upstream asset сам.
    const assertionsList = Array.isArray(active?.assertions)
      ? (active.assertions as Array<{ label?: unknown }>)
          .filter(a => typeof a.label === 'string')
          .map(a => ({ label: a.label as string }))
      : [];

    return {
      ok: true,
      result: {
        verified,
        manifest: {
          claim_generator: active?.claim_generator as string | undefined,
          signed_by: signatureInfo?.issuer,
          signed_at: signatureInfo?.time,
          assertions: assertionsList,
          title: active?.title as string | undefined,
          format: active?.format as string | undefined,
        },
        trust_chain: trustChain,
        warnings,
      },
    };
  } finally {
    reader.free();
  }
}

/**
 * C2PA-rs officially supports: image/jpeg, image/png, image/webp, image/tiff,
 * image/x-adobe-dng, video/mp4, video/quicktime, video/avi, audio/mpeg, audio/wav,
 * application/pdf, application/c2pa, image/avif, image/heic, image/heif.
 *
 * Conservative allowlist для W2 — только самые ходовые. Расширим по запросам.
 */
function isSupportedFormat(mime: string): boolean {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/tiff',
    'image/avif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
  ].includes(base);
}
