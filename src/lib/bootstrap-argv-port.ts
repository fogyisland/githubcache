/**
 * Pre-import argv → process.env.PORT bridge for `npm run start:5002`.
 *
 * tsx forwards `--port <n>` / `-p <n>` / `--port=<n>` / `-p=<n>` into
 * `process.argv`; we pluck them here so the zod schema in
 * `src/lib/config/env.ts` (which defaults `PORT` to `DEFAULT_DEV_PORT`
 * when missing) sees the operator's choice. Precedence (highest first):
 *
 *   1. `--port` / `-p` argv (this helper)
 *   2. `process.env.PORT` (e.g., from `.env` or systemd unit)
 *   3. `DEFAULT_DEV_PORT` from package.json `dev:port`
 *
 * Lives in its own module so `src/bootstrap.ts` can import it
 * pre-`next`/`react-server-dom` (the bootstrap chain must run BEFORE
 * dynamic-import of `server.js`), and so vitest can unit-test the
 * helper in isolation without booting the full Next.js stack or
 * hitting the top-level `await import('./server.js')` side effect
 * inside `bootstrap.ts`.
 */

/**
 * Scan `argv` for `--port <n>` / `-p <n>` / `--port=<n>` / `-p=<n>`.
 * On the first valid match, write `String(n)` to `processEnv.PORT` and
 * return. On a malformed match (flag without a valid integer, integer
 * out of range 1..65535) throw — better to fail fast at boot than to
 * silently fall back to the default and surprise the operator.
 *
 * Pure function — reads `argv`, writes `processEnv`. Does NOT mutate
 * anything else. Safe to call from anywhere (no next/react imports).
 */
export function applyPortFromArgv(
  argv: readonly string[],
  processEnv: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--port' || arg === '-p') {
      const next = argv[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        const n = Number(next);
        if (n > 0 && n < 65_536) {
          processEnv.PORT = String(n);
          return;
        }
      }
      throw new Error(
        `bootstrap: --port requires a 1-65535 integer argument, got '${next ?? '(missing)'}'`,
      );
    }
    // Also accept --port=<n> / -p=<n>
    const eqIdx = arg.startsWith('--port=')
      ? '--port='.length
      : arg.startsWith('-p=')
        ? '-p='.length
        : -1;
    if (eqIdx > 0) {
      const value = arg.slice(eqIdx);
      if (/^\d+$/.test(value)) {
        const n = Number(value);
        if (n > 0 && n < 65_536) {
          processEnv.PORT = String(n);
          return;
        }
      }
      throw new Error(
        `bootstrap: --port=<n> requires a 1-65535 integer, got '${value}'`,
      );
    }
  }
}
