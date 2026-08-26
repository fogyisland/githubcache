import { env } from '@/lib/config/env';

/**
 * Extract the client IP from request headers. Used for per-IP rate-limit
 * + audit logging.
 *
 * When TRUST_PROXY=true and X-Forwarded-For is set, the left-most address
 * in the chain is returned (the original client per RFC 7239 conventions
 * used by most reverse proxies). When TRUST_PROXY=false, only direct
 * connections are trusted; if XFF is present we still use the first value
 * but it's the operator's responsibility to ensure their edge strips
 * client-supplied XFF before this layer.
 *
 * Returns 'unknown' when no IP can be determined (e.g. a unit test).
 */
export function clientIpFromHeaders(headers: Headers): string {
  if (env.TRUST_PROXY) {
    const fwd = headers.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    const real = headers.get('x-real-ip');
    if (real) return real.trim();
  }
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}
