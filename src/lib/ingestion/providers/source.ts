import { promises as fs } from 'node:fs';
import path from 'node:path';
import { evaluateJsonPath, JsonPathError } from './jsonpath';
import type { ProviderConfig } from './schema';

/**
 * Loads a JSON document from a provider source and returns the items
 * array identified by `itemsPath`.
 *
 * Two transport kinds are supported:
 *   - 'file': reads from local filesystem. Path must be under one of
 *     PROVIDER_FILE_ROOTS (comma-separated absolute dirs in .env).
 *   - 'http': GETs from a remote endpoint, parses JSON, returns array.
 *
 * Failure modes are classified via ProviderSourceError.code so callers
 * (admin UI + audit log) can render actionable messages.
 */

export class ProviderSourceError extends Error {
  public readonly code:
    | 'FILE_NOT_FOUND'
    | 'FILE_OUT_OF_ROOTS'
    | 'HTTP_ERROR'
    | 'JSON_PARSE'
    | 'BAD_ITEMSPATH';
  constructor(message: string, code: ProviderSourceError['code']) {
    super(message);
    this.name = 'ProviderSourceError';
    this.code = code;
  }
}

/**
 * Parses PROVIDER_FILE_ROOTS from env, returning absolute paths.
 * Empty / unset env means no roots configured; all file loads will fail
 * with FILE_OUT_OF_ROOTS.
 */
export function resolveFileRoots(): readonly string[] {
  const raw = process.env.PROVIDER_FILE_ROOTS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((p) => path.resolve(p));
}

function isUnder(child: string, parents: readonly string[]): boolean {
  const abs = path.resolve(child);
  return parents.some((p) => abs === p || abs.startsWith(p + path.sep));
}

async function readJsonFile(
  p: string,
  fileRoots: readonly string[],
): Promise<unknown> {
  const abs = path.resolve(p);
  if (fileRoots.length === 0 || !isUnder(abs, fileRoots)) {
    throw new ProviderSourceError(
      `path "${p}" is outside PROVIDER_FILE_ROOTS`,
      'FILE_OUT_OF_ROOTS',
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ProviderSourceError(`file not found: ${p}`, 'FILE_NOT_FOUND');
    }
    throw new ProviderSourceError(
      `failed to read ${p}: ${(e as Error).message}`,
      'FILE_NOT_FOUND',
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e: unknown) {
    throw new ProviderSourceError(
      `invalid JSON in ${p}: ${(e as Error).message}`,
      'JSON_PARSE',
    );
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const init: RequestInit = { method: 'GET' };
  if (headers) {
    init.headers = headers;
  }
  if (signal) {
    init.signal = signal;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ProviderSourceError(
      `HTTP ${res.status} fetching ${url}`,
      'HTTP_ERROR',
    );
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e: unknown) {
    throw new ProviderSourceError(
      `invalid JSON from ${url}: ${(e as Error).message}`,
      'JSON_PARSE',
    );
  }
}

export interface LoadSourceOptions {
  signal?: AbortSignal;
  fileRoots?: readonly string[];
}

export async function loadProviderSource(
  config: ProviderConfig,
  opts: LoadSourceOptions = {},
): Promise<unknown[]> {
  const fileRoots = opts.fileRoots ?? resolveFileRoots();
  let raw: unknown;
  if (config.kind === 'file') {
    raw = await readJsonFile(config.path, fileRoots);
  } else {
    raw = await fetchJson(config.url, config.headers, opts.signal);
  }
  let items: unknown;
  try {
    items = evaluateJsonPath(raw, config.itemsPath);
  } catch (e: unknown) {
    if (e instanceof JsonPathError) {
      throw new ProviderSourceError(
        `itemsPath "${config.itemsPath}": ${e.message}`,
        'BAD_ITEMSPATH',
      );
    }
    throw e;
  }
  if (!Array.isArray(items)) {
    throw new ProviderSourceError(
      `itemsPath "${config.itemsPath}" did not yield an array`,
      'BAD_ITEMSPATH',
    );
  }
  return items;
}