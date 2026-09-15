/**
 * M32.7.4 — last-line-of-defense against NODE_ENV misconfiguration.
 *
 * Root cause: cloud production ran with NODE_ENV=development (inherited
 * from .env.example via `scripts/init.ts:200` byte-copy). The original
 * `src/bootstrap.ts:30` only set NODE_ENV=production when it was
 * *undefined* — so when .env had NODE_ENV=development (a truthy value),
 * the fallback was a no-op and Node shipped the dev React bundle on top
 * of an already-broken `npm start` execution.
 *
 * This module is the **runtime last-line-of-defense**: it forces
 * NODE_ENV=production whenever the value is 'development' OR undefined,
 * and warns the operator. Exported as a pure function so tests can
 * exercise it without booting the rest of `bootstrap.ts`.
 *
 * Pure module — no imports of `next`, `@/server`, etc. Safe to import
 * from any context (including vitest unit tests).
 */

/**
 * Force NODE_ENV=production if it's undefined or 'development'.
 * Returns the previous value (or the literal 'undefined') so callers can
 * log it.
 *
 * @param envObj - the env record to mutate (e.g., process.env cast)
 * @param log - optional logger; defaults to console.warn
 * @returns the previous NODE_ENV value as a string ('undefined' if it was unset)
 */
export function enforceProductionNodeEnv(
  envObj: Record<string, string | undefined>,
  log: (msg: string) => void = console.warn,
): string {
  const prev = envObj.NODE_ENV ?? 'undefined';
  if (envObj.NODE_ENV === 'development' || !envObj.NODE_ENV) {
    envObj.NODE_ENV = 'production';
    log(
      `[bootstrap] NODE_ENV was '${prev}' — forcing 'production'. ` +
        `Edit .env if this is a local dev box.`,
    );
  }
  return prev;
}