import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BinaryCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * M17 — Detect whether `mysqldump` and `gzip` binaries are on PATH.
 *
 * Called once at bootServer() (see src/lib/database/startup.ts) and the
 * result is cached for the lifetime of the process. The /admin/database
 * page reads the cached state via getBinaryStatus() to decide whether to
 * disable backup/restore buttons.
 *
 * We deliberately do NOT fail to boot when the binaries are missing —
 * the rest of the app (queries, ingestion, scheduler) doesn't need them.
 * The page surfaces a yellow warning banner instead, with install hints.
 */
let cachedState: { mysqldump: BinaryCheckResult; gzip: BinaryCheckResult } | null = null;

async function probe(bin: string): Promise<BinaryCheckResult> {
  try {
    // `--version` is the universal "are you there?" probe; both mysqldump
    // and gzip print it to stdout and exit 0.
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000 });
    return { available: true, version: stdout.trim().split('\n')[0] ?? '' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    return { available: false, error: err };
  }
}

export async function checkBinaries(): Promise<{
  mysqldump: BinaryCheckResult;
  gzip: BinaryCheckResult;
}> {
  const [mysqldump, gzip] = await Promise.all([probe('mysqldump'), probe('gzip')]);
  cachedState = { mysqldump, gzip };
  return cachedState;
}

export function getBinaryStatus(): { mysqldump: BinaryCheckResult; gzip: BinaryCheckResult } {
  if (!cachedState) {
    return {
      mysqldump: { available: false, error: 'not checked yet' },
      gzip: { available: false, error: 'not checked yet' },
    };
  }
  return cachedState;
}

export function binariesReady(): boolean {
  if (!cachedState) return false;
  return cachedState.mysqldump.available && cachedState.gzip.available;
}
