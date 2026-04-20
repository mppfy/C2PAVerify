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

let initialized = false;
let initPromise: Promise<typeof c2pa> | null = null;

/**
 * One-time initialization of c2pa-wasm.
 * Idempotent — multiple concurrent calls share the same init promise.
 */
export async function ensureC2paReady(): Promise<typeof c2pa> {
  if (initialized) return c2pa;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Install polyfill BEFORE wasm init so FileReaderSync is present when
    // wasm-bindgen imports are wired up.
    installFileReaderSyncPolyfill();
    await initC2pa({ module_or_path: wasmModule as WebAssembly.Module });
    initialized = true;
    return c2pa;
  })();

  return initPromise;
}

export type { WasmReader } from '@contentauth/c2pa-wasm';
