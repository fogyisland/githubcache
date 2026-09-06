/**
 * M26 — signup rate-limit helper.
 *
 * Default ceiling: 50000 per IP per hour (very generous — effectively
 * only blocks scripted signup storms). Tunable via `SIGNUP_RATE_PER_HOUR`
 * env var for ops who want to tighten it.
 *
 * Lives in `src/lib/` (not in the server-action file) because Next.js
 * requires every export of a `'use server'` module to be async; this
 * helper is sync and is consumed by `signupAction` from `@/lib/auth/
 * signup-rate`.
 */

export const SIGNUP_RATE_PER_HOUR_DEFAULT = 50_000;

export function getSignupRateLimit(): number {
  const envVal = process.env['SIGNUP_RATE_PER_HOUR'];
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SIGNUP_RATE_PER_HOUR_DEFAULT;
}
