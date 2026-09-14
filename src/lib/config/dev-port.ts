import pkg from '../../../package.json';

/**
 * Single source of truth for the dev server's default port.
 *
 * Sourced from the top-level `dev:port` field in package.json (M0 originally
 * hard-coded 3000; M8 migrated the bootstrap/dev/start scripts to 5002 but
 * missed the zod default in env.ts, so a missing .env PORT silently fell back
 * to 3000 — fixed 2026-09-13 by centralising the value here).
 *
 * Overridable via the PORT env var (`.env` or shell). next dev / next start
 * still hard-code `-p 5002` in their package.json scripts because next CLI
 * has no read-from-package.json support — keep those two lines in sync with
 * the `dev:port` field below when changing ports.
 */

const raw: unknown = (pkg as Record<string, unknown>)['dev:port'];

export const DEFAULT_DEV_PORT: number =
  typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw < 65_536
    ? raw
    : 5002;
