/**
 * CAI trust list → c2pa-rs Settings JSON.
 *
 * Source: https://verify.contentauthenticity.org/trust/
 *   - anchors.pem  — 27 root CAs (44 KB), baseline для legitimate Adobe/Truepic/MS signers
 *   - allowed.pem  — 114 end-entity certs (240 KB), stricter production signer set
 *   - store.cfg    — allowed EKU OIDs
 *
 * NOTE: Это "interim" CAI trust list (frozen 2026-03-16). Официальный C2PA trust
 * list (как появится публичный endpoint) — отдельный W4+ upgrade. Для existing
 * Adobe Content Credentials assets interim list корректно валидирует цепочки.
 *
 * Bundle impact: ~290 KB text → ~80 KB gzipped. Bump Worker script size с 3.0 MB
 * до ~3.08 MB gzipped — в пределах Workers Paid 10 MB limit.
 *
 * Rotation strategy: files bundled into Worker binary (redeploy needed to update).
 * Cadence observed: ~monthly. W4+ задача — cron trigger + KV hot-swap.
 */

import anchorsPem from './trust/anchors.pem';
import allowedPem from './trust/allowed.pem';
import storeCfg from './trust/store.cfg';

/**
 * Convert store.cfg (OID list with `//` comments) to plain OID-per-line format
 * accepted by c2pa-rs `trust_config`.
 */
function cleanStoreCfg(cfg: string): string {
  return cfg
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('#'))
    .join('\n');
}

/**
 * Build c2pa-rs Settings JSON for `loadSettings()`.
 *
 * Fields per contentauth/c2pa-rs sdk/src/settings/mod.rs:
 *   - verify.verify_trust          — turn on trust anchor validation
 *   - verify.verify_timestamp_trust — timestamp cert chains also validated
 *   - verify.ocsp_fetch            — WASM no-op (reqwest unavailable), leave false
 *   - verify.remote_manifest_fetch — OK, JS fetch delegated
 *   - trust.trust_anchors          — PEM bundle of root CAs
 *   - trust.allowed_list           — PEM bundle end-entity certs (stricter)
 *   - trust.trust_config           — plain EKU OIDs list
 */
export function buildTrustSettingsJson(): string {
  return JSON.stringify({
    version: 1,
    verify: {
      verify_after_reading: true,
      verify_trust: true,
      verify_timestamp_trust: true,
      ocsp_fetch: false, // WASM: no reqwest, stapled OCSP only
      remote_manifest_fetch: true,
    },
    trust: {
      verify_trust_list: true,
      trust_anchors: anchorsPem,
      allowed_list: allowedPem,
      trust_config: cleanStoreCfg(storeCfg),
    },
  });
}
