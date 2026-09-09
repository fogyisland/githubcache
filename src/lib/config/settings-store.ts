import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { upsertEnvLine } from '@/lib/setup';
import { invalidateEnvCache } from '@/lib/config/env';

/**
 * M28.api-settings — runtime .env file write.
 *
 * Settings UI (admin/api-settings) needs to persist user-tuned
 * values to .env. The server is a long-running process; the env
 * cache in `@/lib/config/env` is cleared on every write so the
 * NEXT read sees the new value, but the running scheduler / pool
 * keep their existing values until restart. We surface that
 * requirement in the UI ("changes require restart").
 *
 * Atomic write: read current content, mutate in memory, write
 * back in a single writeFileSync. fs.renameSync could give true
 * atomicity but the page-load window is small enough that a
 * power loss here would just revert to the previous good state.
 */

const ENV_PATH = join(process.cwd(), '.env');

/** Settings the admin UI is allowed to change. Anything else in .env
 *  (DATABASE_URL, SESSION_SECRET, etc.) stays untouched. */
export const TUNABLE_KEYS = [
  // GitHub query cadence
  'SCHEDULER_TICK_MS',
  'SCHEDULER_BATCH_SIZE',
  'NIGHTLY_SWEEP_INTERVAL_MS',
  'SCHEDULER_CORE_SWEEP_HOURS',
  'SCHEDULER_RELEASES_SWEEP_HOURS',
  'SCHEDULER_BRANCHES_SWEEP_HOURS',
  // Token pool
  'TOKEN_AUTO_DISABLE_THRESHOLD',
  // Public API rate limits
  'PUBLIC_LOOKUP_RATE_PER_MIN',
  'PUBLIC_REPO_RATE_PER_HOUR',
] as const;

export type TunableKey = (typeof TUNABLE_KEYS)[number];

export type TunableValue = string | number | boolean;

export interface SettingsUpdate {
  key: TunableKey;
  value: TunableValue;
}

export interface SettingsResult {
  ok: boolean;
  applied: number;
  error?: string;
  /** When non-empty, lists which keys were written so the toast
   *  can show exactly what changed. */
  changed: TunableKey[];
}

/** Read .env from disk and return as a plain key/value map (strings only). */
function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf8');
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] && m[2] !== undefined) {
      out[m[1]] = m[2];
    }
  }
  return out;
}

/** Get the current effective value of a tunable — env file first,
 *  then process.env (in case it was set via shell or .env.production). */
export function readTunables(): Record<TunableKey, string> {
  const file = readEnvFile();
  const out = {} as Record<TunableKey, string>;
  for (const k of TUNABLE_KEYS) {
    out[k] = file[k] ?? process.env[k] ?? '';
  }
  return out;
}

/** Persist a batch of updates to .env. Returns the keys that
 *  actually changed. The env cache is invalidated before return
 *  so the next `env.X` access sees the new value. */
export function writeTunables(updates: SettingsUpdate[]): SettingsResult {
  if (!existsSync(ENV_PATH)) {
    return {
      ok: false,
      applied: 0,
      error: '.env not found at project root — the wizard must run first',
      changed: [],
    };
  }
  const before = readEnvFile();
  let content = readFileSync(ENV_PATH, 'utf8');
  const changed: TunableKey[] = [];
  for (const { key, value } of updates) {
    const stringValue = formatValue(value);
    if (before[key] === stringValue) continue;
    content = upsertEnvLine(content, key, stringValue);
    changed.push(key);
  }
  if (changed.length === 0) {
    return { ok: true, applied: 0, changed: [] };
  }
  try {
    writeFileSync(ENV_PATH, content);
  } catch (e) {
    return {
      ok: false,
      applied: 0,
      error: `write .env failed: ${(e as Error).message}`,
      changed: [],
    };
  }
  // Invalidate the in-process cache so the next `env.X` access
  // re-parses the file. Long-running tasks (scheduler / pool) keep
  // their captured values until restart — the page surfaces that.
  invalidateEnvCache();
  return { ok: true, applied: changed.length, changed };
}

function formatValue(v: TunableValue): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}