import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF protections for server-side outbound HTTP (workflow `api` node, operator-
 * supplied job-source URLs, etc.). We block non-HTTP(S) protocols and any request
 * that resolves to a private / reserved / loopback / link-local address. The DNS
 * guard is enforced at connection time via a custom agent `lookup`, which also
 * covers redirects and DNS-rebinding.
 */

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

/** True when an IP literal points at a private / reserved / loopback range. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return isBlockedIpv4(ip);
  }
  if (version === 6) {
    const s = ip.toLowerCase();
    if (s.startsWith('::ffff:')) {
      const mapped = s.slice('::ffff:'.length);
      if (isIP(mapped) === 4) {
        return isBlockedIpv4(mapped);
      }
    }
    if (s === '::1' || s === '::') return true; // loopback / unspecified
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // fc00::/7 unique-local
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) {
      return true; // fe80::/10 link-local
    }
    return false;
  }
  return true; // not a literal IP — fail closed
}

/**
 * Validate the URL shape before a request: HTTP(S) only, and reject obvious
 * local hostnames or private IP literals. DNS-resolved addresses are checked
 * separately by the guarded agent lookup.
 */
export function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Blocked request: invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked request: unsupported protocol "${url.protocol}"`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '0.0.0.0'
  ) {
    throw new Error(`Blocked request to local host "${host}"`);
  }

  if (isIP(host) && isBlockedIp(host)) {
    throw new Error(`Blocked request to private address "${host}"`);
  }

  return url;
}

function guardedLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void,
): void {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;

  dnsLookup(hostname, opts, (err, address: string | LookupAddress[], family?: number) => {
    if (err) {
      cb(err, address as any, family);
      return;
    }
    const resolved = Array.isArray(address)
      ? address.map((a) => a.address)
      : [address];
    const blocked = resolved.find((ip) => isBlockedIp(ip));
    if (blocked) {
      cb(
        Object.assign(new Error(`Blocked request to private address "${blocked}"`), {
          code: 'ESSRFBLOCKED',
        }),
        address as any,
        family,
      );
      return;
    }
    cb(null, address as any, family);
  });
}

let cachedAgents: { httpAgent: HttpAgent; httpsAgent: HttpsAgent } | null = null;

/** Shared http(s) agents whose DNS lookup rejects private/reserved addresses. */
export function guardedHttpAgents(): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  if (!cachedAgents) {
    cachedAgents = {
      httpAgent: new HttpAgent({ lookup: guardedLookup as any }),
      httpsAgent: new HttpsAgent({ lookup: guardedLookup as any }),
    };
  }
  return cachedAgents;
}
