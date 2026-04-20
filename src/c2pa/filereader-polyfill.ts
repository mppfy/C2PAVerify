/**
 * FileReaderSync polyfill для Cloudflare Workers (workerd).
 *
 * Проблема:
 *   c2pa-wasm внутри Rust кода вызывает `new FileReaderSync().readAsArrayBuffer(blobSlice)`
 *   для синхронного чтения байтов. FileReaderSync существует только в Web Worker-ах,
 *   не в Worker Threads и не в workerd. Без polyfill — ReferenceError в runtime.
 *
 * Решение:
 *   1. Заранее буферим входной Blob → Uint8Array → кладём в WeakMap<Blob, Uint8Array>.
 *   2. Патчим Blob.prototype.slice: если родитель есть в WeakMap, считаем срез байтов
 *      синхронно и регистрируем в WeakMap новый нативный Blob-slice.
 *   3. Определяем globalThis.FileReaderSync с методом readAsArrayBuffer(blob), который
 *      достаёт из WeakMap байты и возвращает ArrayBuffer.
 *
 * Идемпотентно — повторные installBlobPolyfill() no-op'ят.
 *
 * WHY this works: нативный Blob.slice продолжает возвращать настоящий Blob (Rust видит
 * правильный JS тип), а наша WeakMap синхронно хранит содержимое. FileReaderSync
 * просто достаёт уже-закэшированные bytes без async I/O.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

// WeakMap tracking known byte contents for each Blob we've seen/sliced.
const blobBytes: WeakMap<Blob, Uint8Array> = g.__c2paBlobBytes ?? new WeakMap();
g.__c2paBlobBytes = blobBytes;

/**
 * Install the polyfill once per Worker isolate.
 * Call this BEFORE registering any Blob in registerBlobBytes.
 *
 * Idempotency uses isolate-level sentinel (g.__c2paPolyfillInstalled) to survive
 * module re-evaluation in the same isolate — otherwise Blob.prototype.slice
 * would be wrapped twice.
 */
export function installFileReaderSyncPolyfill(): void {
  if (g.__c2paPolyfillInstalled) return;
  g.__c2paPolyfillInstalled = true;

  // 1. Patch Blob.prototype.slice to propagate byte tracking.
  const originalSlice = Blob.prototype.slice;
  Blob.prototype.slice = function patchedSlice(
    this: Blob,
    start?: number,
    end?: number,
    contentType?: string,
  ): Blob {
    const parentBytes = blobBytes.get(this);
    const slicedBlob = originalSlice.call(this, start, end, contentType);

    if (parentBytes) {
      const s = normalizeOffset(start, parentBytes.byteLength);
      const e = normalizeOffset(end, parentBytes.byteLength, parentBytes.byteLength);
      // Uint8Array.slice returns a copy, which is what FileReaderSync expects.
      const slicedBytes = parentBytes.slice(s, e);
      blobBytes.set(slicedBlob, slicedBytes);
    }

    return slicedBlob;
  };

  // 2. Define FileReaderSync on globalThis.
  class FileReaderSyncPolyfill {
    readAsArrayBuffer(blob: Blob): ArrayBuffer {
      const bytes = blobBytes.get(blob);
      if (!bytes) {
        throw new Error(
          'FileReaderSync polyfill: blob not pre-buffered. ' +
            'Call registerBlobBytes(blob, bytes) before passing to c2pa.',
        );
      }
      // Return standalone ArrayBuffer — copy to avoid shared buffer concerns.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    }

    readAsText(_blob: Blob): string {
      throw new Error('FileReaderSync polyfill: readAsText not implemented');
    }

    readAsDataURL(_blob: Blob): string {
      throw new Error('FileReaderSync polyfill: readAsDataURL not implemented');
    }

    readAsBinaryString(_blob: Blob): string {
      throw new Error('FileReaderSync polyfill: readAsBinaryString not implemented');
    }
  }

  if (typeof g.FileReaderSync === 'undefined') {
    g.FileReaderSync = FileReaderSyncPolyfill;
  }
}

/**
 * Pre-buffer a Blob so it can be read synchronously by FileReaderSync polyfill.
 * Returns the same Blob (tracked) — caller passes this to c2pa-wasm.
 */
export async function registerBlobBytes(blob: Blob): Promise<Blob> {
  if (!blobBytes.has(blob)) {
    const buffer = await blob.arrayBuffer();
    blobBytes.set(blob, new Uint8Array(buffer));
  }
  return blob;
}

function normalizeOffset(
  raw: number | undefined,
  length: number,
  fallback: number = 0,
): number {
  if (raw === undefined) return fallback;
  if (raw < 0) return Math.max(0, length + raw);
  return Math.min(raw, length);
}
