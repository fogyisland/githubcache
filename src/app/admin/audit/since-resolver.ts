/**
 * Translate a `?since=<token>` query string to a `from` Date.
 *
 * Recognized tokens:
 *   - `<n>m` — last N minutes (e.g. `15m`, `30m`)
 *   - `<n>h` — last N hours   (e.g. `1h`, `24h`  — but `24h` is accepted
 *     even though it crosses a day; `1d` is the cleaner form for that)
 *   - `<n>d` — last N days    (e.g. `7d`)
 *
 * Any token that doesn't match the pattern returns `undefined` so the
 * caller treats the request as "no time filter" instead of an error.
 * This is the helper used by the audit page server component when it
 * reads `searchParams.since` and translates it into the `from` Date
 * that `queryAuditLog` consumes.
 *
 * Clamp: N is capped at MAX_UNITS. A user typing `99999999d` would
 * otherwise compute `n * 86_400_000` near `MAX_SAFE_INTEGER` and could
 * overflow to a future date. We reject anything above MAX_UNITS as
 * malformed.
 */
const MAX_UNITS = 365;

export function resolveSince(
  token: string | undefined,
  now: Date,
): Date | undefined {
  if (!token) return undefined;
  const m = /^(\d+)([mhd])$/.exec(token);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n) || n <= 0 || n > MAX_UNITS) return undefined;
  const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return new Date(now.getTime() - n * ms);
}
