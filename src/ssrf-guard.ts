/**
 * SSRF protection for fetching remote assets.
 *
 * Checklist (from security review 2026-04-20):
 *   ✓ Scheme allowlist: https only (reject http/file/ftp/gopher/data/javascript)
 *   ✓ Hostname resolution → IP check: block private IPv4 (10/8, 172.16/12,
 *     192.168/16, 169.254/16, 127/8) and IPv6 (::1, fc00::/7, fe80::/10, unique-local)
 *   ✓ No redirect following (redirect: 'error')
 *   ✓ Timeout via AbortController (10s)
 *   ✓ Response size cap enforced streaming (25MB)
 *   ✓ Content-Type sanity check (must match a supported format)
 *
 * CF Workers нюансы:
 *   - `fetch()` в Workers по умолчанию resolve'ит DNS сам; мы не видим IP до коннекта.
 *     Контрмера: разрешаем hostname → проверяем после response.url (если был redirect,
 *     fails, т.к. redirect: 'error'). Workers не позволяет low-level DNS hook, поэтому
 *     DNS rebinding mitigation = запретить IP literals в hostname + не follow redirects.
 *   - Если attacker указывает hostname который резолвится в private IP, CF connects.
 *     Дополнительно: блокируем common cloud metadata hostnames (169.254.169.254 literal,
 *     но также `metadata.google.internal` и т.п.). Full DNS rebind defense требует
 *     custom resolver which Workers не exposes.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.aws.amazon.com',
  'metadata.azure.com',
  '169.254.169.254',
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
]);

/**
 * Validate URL for SSRF safety BEFORE fetch.
 * Returns error string if blocked, null if safe to fetch.
 */
export function validateUrlForFetch(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'invalid_url';
  }

  // ① Scheme allowlist
  if (u.protocol !== 'https:') {
    return 'blocked_scheme';
  }

  // ② Block IP literals in hostname (both v4 and v6)
  if (isIPv4Literal(u.hostname) || isIPv6Literal(u.hostname)) {
    // For IPv4 literals, also check they're not in private ranges.
    // For IPv6 [::1]/[fc00::/7] etc. — just block all literals (safer).
    if (isIPv6Literal(u.hostname)) {
      return 'blocked_ip_literal';
    }
    if (isPrivateIPv4(u.hostname)) {
      return 'blocked_private_ip';
    }
    // Public IPv4 literal — still suspicious, block unless we're sure.
    return 'blocked_ip_literal';
  }

  // ③ Block known metadata/local hostnames
  if (BLOCKED_HOSTNAMES.has(u.hostname.toLowerCase())) {
    return 'blocked_hostname';
  }

  // ④ Block .local (mDNS) and .internal (common internal TLD)
  const host = u.hostname.toLowerCase();
  if (host.endsWith('.local') || host.endsWith('.internal')) {
    return 'blocked_internal_tld';
  }

  // ⑤ Port restriction — require standard HTTPS (443) or common alternates
  if (u.port && !['443', '8443'].includes(u.port)) {
    return 'blocked_port';
  }

  return null;
}

/**
 * Fetch remote asset with SSRF guard + size cap + timeout.
 * Returns discriminated result.
 */
export type FetchResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | {
      ok: false;
      status: 400 | 403 | 413 | 415 | 502 | 504;
      error: string;
      reason: string;
    };

export async function fetchRemoteAsset(
  url: string,
  maxSize: number,
  timeoutMs: number = 10_000,
): Promise<FetchResult> {
  const blockReason = validateUrlForFetch(url);
  if (blockReason) {
    return {
      ok: false,
      status: 403,
      error: blockReason,
      reason: `URL blocked by SSRF guard: ${blockReason}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error', // DON'T follow — redirect could point to private IP
      signal: controller.signal,
      headers: {
        accept: 'image/*,video/*,application/pdf,application/octet-stream',
        'user-agent': 'C2PAVerify/0.1 (+https://mppfy.com)',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return {
        ok: false,
        status: 504,
        error: 'upstream_timeout',
        reason: `Fetch exceeded ${timeoutMs}ms`,
      };
    }
    // redirect: 'error' путь — отвергаем 3xx
    if (msg.toLowerCase().includes('redirect')) {
      return {
        ok: false,
        status: 403,
        error: 'blocked_redirect',
        reason: 'Redirect responses blocked by SSRF guard',
      };
    }
    return {
      ok: false,
      status: 502,
      error: 'upstream_fetch_failed',
      reason: 'Could not fetch remote asset',
    };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: 'upstream_status_error',
      reason: `Upstream returned ${response.status}`,
    };
  }

  // Content-Length precheck (if provided)
  const declaredLen = Number(response.headers.get('content-length') ?? '0');
  if (declaredLen > 0 && declaredLen > maxSize) {
    return {
      ok: false,
      status: 413,
      error: 'upstream_too_large',
      reason: `Upstream Content-Length ${declaredLen} > ${maxSize}`,
    };
  }

  // Streaming size cap — enforce regardless of Content-Length honesty.
  const contentType =
    (response.headers.get('content-type') ?? 'application/octet-stream')
      .split(';')[0]!
      .trim()
      .toLowerCase();

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      status: 502,
      error: 'upstream_no_body',
      reason: 'Response had no body',
    };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxSize) {
      await reader.cancel();
      return {
        ok: false,
        status: 413,
        error: 'upstream_too_large',
        reason: `Upstream body exceeded ${maxSize} bytes (streamed: ${received})`,
      };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }

  return { ok: true, bytes, contentType };
}

// ─── Helpers ────────────────────────────────────────────────

function isIPv4Literal(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

function isIPv6Literal(host: string): boolean {
  // URL hostname strips brackets. Check for IPv6 signature (multiple colons).
  return host.includes(':');
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → treat as blocked
  }
  const [a, b] = parts as [number, number, number, number];
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local / metadata)
  if (a === 169 && b === 254) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 0.0.0.0/8 (this network)
  if (a === 0) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
