/**
 * c2pa-wasm loader для Cloudflare Workers.
 *
 * Workers bundling: `import wasmModule from '@contentauth/c2pa-wasm/c2pa.wasm'`
 * загружает WASM как compiled module (см. [[rules]] CompiledWasm в wrangler.toml).
 *
 * Bundle size note:
 *   - c2pa_bg.wasm = 7.5 MB raw → ~2-3 MB gzipped
 *   - Workers paid tier limit = 10 MB gzipped per script → ок
 *   - Free tier = 1 MB → NOT ok (нужен Workers Paid upgrade для prod)
 *
 * Runtime note:
 *   c2pa-wasm внутри использует FileReaderSync (Web Worker API), которого нет
 *   в workerd. Мы ставим polyfill ДО init — см. filereader-polyfill.ts.
 */

import wasmModule from '@contentauth/c2pa-wasm/c2pa.wasm';
import initC2pa, * as c2pa from '@contentauth/c2pa-wasm';
import { installFileReaderSyncPolyfill } from './filereader-polyfill';
import { buildTrustSettingsJson } from './trust-config';

let initialized = false;
let initPromise: Promise<typeof c2pa> | null = null;

/**
 * One-time initialization of c2pa-wasm.
 * Idempotent — multiple concurrent calls share the same init promise.
 *
 * Init sequence:
 *   1. installFileReaderSyncPolyfill() — ДО WASM init, чтобы FileReaderSync был
 *      найден wasm-bindgen при setup imports.
 *   2. initC2pa(wasmModule) — instantiate WASM binding.
 *   3. loadSettings(trustJson) — применить CAI trust list (anchors + allowed + EKU).
 *      Without этого signing certs returned как "untrusted" (trust_chain: 'partial').
 */
export async function ensureC2paReady(): Promise<typeof c2pa> {
  if (initialized) return c2pa;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    installFileReaderSyncPolyfill();
    await initC2pa({ module_or_path: wasmModule as WebAssembly.Module });
    try {
      c2pa.loadSettings(buildTrustSettingsJson());
    } catch (err) {
      // loadSettings failure = trust list invalid OR schema drift. Fail-safe:
      // log и продолжаем без trust anchors (trust_chain вернётся 'partial' вместо
      // полного crash сервиса). Alerts via logs; W4+ — replace with hard fail.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[c2pa] loadSettings failed — continuing without trust list:', msg);
    }
    initialized = true;
    return c2pa;
  })();

  return initPromise;
}

export type { WasmReader } from '@contentauth/c2pa-wasm';
