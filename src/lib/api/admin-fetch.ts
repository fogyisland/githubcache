import { fetchCsrfToken } from '@/lib/csrf/client';

export type AdminFetchInit = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Fetch wrapper for /api/admin/* mutations (and the occasional GET).
 *
 * Behavior:
 *  - Auto-injects `credentials: 'include'` so Set-Cookie persists.
 *  - Auto-injects `x-csrf-token` header from fetchCsrfToken() (single-flight
 *    coalesced; M28.bug).
 *  - JSON-encodes `body` if it's a plain object (FormData / string pass through).
 *  - Throws Error('adminFetch ${status}: ${body}') on non-2xx.
 *  - Returns parsed JSON on 2xx; undefined on 204 / non-JSON.
 *
 * Use this instead of raw fetch() in any admin client component that
 * hits /api/admin/*. See docs/admin-data-fetch.md for policy.
 */
export async function adminFetch<T = unknown>(
  url: string,
  init: AdminFetchInit = {},
): Promise<T> {
  const { body, headers = {}, ...rest } = init;
  const csrf = await fetchCsrfToken();
  const finalHeaders: Record<string, string> = {
    ...headers,
    'x-csrf-token': csrf,
  };
  let payload: BodyInit | undefined;
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    typeof body !== 'string'
  ) {
    finalHeaders['content-type'] = finalHeaders['content-type'] ?? 'application/json';
    payload = JSON.stringify(body);
  } else {
    payload = body as BodyInit | undefined;
  }
  const res = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: finalHeaders,
    ...(payload !== undefined ? { body: payload } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`adminFetch ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Reset the shared CSRF cache. Useful in test environments or after a
 * logout/login cycle where the cookie was rotated out-of-band.
 *
 * Re-exported from @/lib/csrf/client for convenience so callers don't
 * need to import both modules.
 */
export { resetCsrfCache } from '@/lib/csrf/client';