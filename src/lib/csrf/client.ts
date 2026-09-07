/**
 * Client-side helper for fetching the CSRF token before a mutating
 * /api/admin/* request.
 *
 * Why this exists (M28.bug — discovered 2026-09-07):
 *   The original pattern was
 *
 *     useEffect(() => {
 *       void fetch('/api/admin/auth/csrf')
 *         .then(r => r.json())
 *         .then(d => setCsrf(d.csrfToken));
 *     }, []);
 *
 *   which has two interacting bugs:
 *
 *     1. Missing `credentials: 'include'`. The endpoint returns
 *        Set-Cookie: ghc_csrf=...; but the browser drops it on the
 *        first call, so the React state has a token while the cookie
 *        jar stays empty. The double-submit middleware then 403's
 *        every subsequent mutating POST.
 *
 *     2. No module-level inflight sharing. /api/admin/auth/csrf
 *        rotates the token on every call. Multiple client components
 *        mounting in parallel (e.g. a page with KeyActions +
 *        LimitsForm, or HMR remounts in dev) each fire their own
 *        fetch, each rotating the cookie. Whichever component mounts
 *        last has its state out of sync with the persisted cookie.
 *
 * This helper:
 *   - Adds `credentials: 'include'` so Set-Cookie persists.
 *   - Coalesces concurrent calls into one inflight Promise so all
 *     callers in the same page load see the same (cookie, token)
 *     pair.
 *   - Releases the inflight lock on the next tick so subsequent
 *     bursts (e.g. after the cookie expires) can refetch fresh.
 *   - Throws on HTTP error or missing body so callers can `.catch`
 *     and reset state.
 */

let csrfInflight: Promise<string> | null = null;

export function fetchCsrfToken(): Promise<string> {
  if (csrfInflight) return csrfInflight;
  csrfInflight = fetch('/api/admin/auth/csrf', { credentials: 'include' })
    .then((r) => {
      if (!r.ok) throw new Error(`csrf HTTP ${r.status}`);
      return r.json() as Promise<{ csrfToken?: string }>;
    })
    .then((d) => {
      if (!d.csrfToken) throw new Error('csrf missing in body');
      return d.csrfToken;
    })
    .finally(() => {
      // Release the lock on the next tick so callers that arrive
      // synchronously after us still coalesce into the same fetch,
      // but later bursts (cookie rotation, expired session) can
      // trigger a fresh fetch.
      setTimeout(() => {
        csrfInflight = null;
      }, 0);
    });
  return csrfInflight;
}

/**
 * Reset the shared cache. Useful in test environments or after a
 * logout/login cycle where the cookie was rotated out-of-band and
 * the cached promise would just re-issue the same (now stale) token.
 */
export function resetCsrfCache(): void {
  csrfInflight = null;
}