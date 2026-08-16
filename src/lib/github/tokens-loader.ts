import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

export interface LoadedToken {
  raw: string;
  first4: string;
  last4: string;
  hash: string;
}

/**
 * Loads GitHub tokens from GITHUB_TOKENS_FILE (one per line) or GITHUB_TOKENS
 * (comma-separated). File takes precedence when both are set.
 *
 * - Skips blank lines and lines starting with `#` (file format comments)
 * - Trims whitespace around each token
 * - Dedupes by hash (if same token appears twice, returns it once)
 * - Returns [] when neither var is set or both produce no tokens after parsing
 * - Throws when GITHUB_TOKENS_FILE is set but the file cannot be read
 */
export function loadTokensFromEnv(): LoadedToken[] {
  const tokens = env.GITHUB_TOKENS_FILE
    ? loadFromFile(env.GITHUB_TOKENS_FILE)
    : loadFromEnvString(env.GITHUB_TOKENS ?? '');
  return dedupe(tokens);
}

function loadFromFile(path: string): LoadedToken[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(
      `GITHUB_TOKENS_FILE is set to "${path}" but the file could not be read: ${(e as Error).message}`,
    );
  }
  return parseLines(raw);
}

function loadFromEnvString(value: string): LoadedToken[] {
  if (!value.trim()) return [];
  return parseLines(value.replace(/,/g, '\n'));
}

function parseLines(input: string): LoadedToken[] {
  const out: LoadedToken[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    out.push(toLoadedToken(trimmed));
  }
  return out;
}

function toLoadedToken(raw: string): LoadedToken {
  const first4 = raw.slice(0, 4);
  const last4 = raw.length >= 4 ? raw.slice(-4) : raw;
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, first4, last4, hash };
}

function dedupe(tokens: LoadedToken[]): LoadedToken[] {
  const seen = new Set<string>();
  const out: LoadedToken[] = [];
  for (const t of tokens) {
    if (seen.has(t.hash)) continue;
    seen.add(t.hash);
    out.push(t);
  }
  return out;
}

// Log count at boot so missing-config is loud (not silent zero).
logger.info(
  { count: loadTokensFromEnv().length, source: env.GITHUB_TOKENS_FILE ? 'file' : 'env' },
  'github tokens loaded',
);