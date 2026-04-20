/**
 * Magic-bytes validation for uploaded assets.
 *
 * Почему это здесь:
 *   Client отправляет multipart с Content-Type на своё усмотрение. Можно послать
 *   polyglot файл (JS/ZIP/PE) с заголовком `Content-Type: image/jpeg`. c2pa-rs сам
 *   верифицирует структуру, но передавать ему заведомо несоответствующий format
 *   hint — путь к amplification DoS или surprise parsing paths.
 *
 *   Проверяем первые N байт против known signatures и fail fast (415), если format
 *   hint из Content-Type не соответствует actual magic bytes.
 */

/**
 * Map from MIME → list of valid magic byte sequences.
 * Для каждого format может быть несколько valid sigs (variants/flavors).
 */
const SIGNATURES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]], // SOI marker
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], // PNG signature
  'image/webp': [
    // RIFF....WEBP — check RIFF at 0, WEBP at offset 8 handled separately below
    [0x52, 0x49, 0x46, 0x46],
  ],
  'image/tiff': [
    [0x49, 0x49, 0x2a, 0x00], // little-endian
    [0x4d, 0x4d, 0x00, 0x2a], // big-endian
  ],
  'image/avif': [
    // ftyp box at offset 4
    [0x66, 0x74, 0x79, 0x70],
  ],
  'image/heic': [[0x66, 0x74, 0x79, 0x70]], // ftyp at offset 4
  'image/heif': [[0x66, 0x74, 0x79, 0x70]],
  'video/mp4': [[0x66, 0x74, 0x79, 0x70]], // ftyp at offset 4
  'video/quicktime': [[0x66, 0x74, 0x79, 0x70]],
  'audio/mpeg': [
    [0x49, 0x44, 0x33], // ID3 tag
    [0xff, 0xfb], // MPEG frame sync
    [0xff, 0xf3],
    [0xff, 0xf2],
  ],
  'audio/wav': [[0x52, 0x49, 0x46, 0x46]], // RIFF
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

/**
 * MIMEs where signature is at offset 4 (ISO BMFF family: MP4, MOV, AVIF, HEIC).
 */
const ISO_BMFF_FORMATS = new Set([
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
]);

/**
 * Validate that the blob's first bytes match expected signature for `format`.
 * Returns true if valid or unknown format (unknown = not in our allowlist anyway
 * — caller should check isSupportedFormat first).
 */
export async function validateMagicBytes(
  blob: Blob,
  format: string,
): Promise<boolean> {
  const sigs = SIGNATURES[format];
  if (!sigs) return true; // unknown format — skip (should have been rejected upstream)

  const headerSize = 32;
  const head = new Uint8Array(
    await blob.slice(0, headerSize).arrayBuffer(),
  );

  // ISO BMFF: signature at offset 4
  if (ISO_BMFF_FORMATS.has(format)) {
    return sigs.some(sig => matchesAt(head, sig, 4));
  }

  // WebP: RIFF at 0 + "WEBP" at 8
  if (format === 'image/webp') {
    const riffOk = matchesAt(head, [0x52, 0x49, 0x46, 0x46], 0);
    const webpOk = matchesAt(head, [0x57, 0x45, 0x42, 0x50], 8);
    return riffOk && webpOk;
  }

  // WAV: RIFF at 0 + "WAVE" at 8
  if (format === 'audio/wav') {
    const riffOk = matchesAt(head, [0x52, 0x49, 0x46, 0x46], 0);
    const waveOk = matchesAt(head, [0x57, 0x41, 0x56, 0x45], 8);
    return riffOk && waveOk;
  }

  // Default: signature at offset 0
  return sigs.some(sig => matchesAt(head, sig, 0));
}

function matchesAt(head: Uint8Array, sig: number[], offset: number): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (head[offset + i] !== sig[i]) return false;
  }
  return true;
}
