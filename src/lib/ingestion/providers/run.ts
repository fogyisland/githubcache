import { prisma } from '@/lib/db/client';
import { evaluateJsonPath } from './jsonpath';
import { loadProviderSource } from './source';
import { parseProviderConfig, type ProviderConfig } from './schema';
import { parseGitHubUrl } from './extract';

/**
 * previewProvider — the orchestration layer that turns a provider's
 * items into a counts report (preview). Bulk insertion is intentionally
 * NOT supported: per the user directive ("不支持批量提交"), each
 * owner/name pair must be queued individually via the public lookup
 * API.
 *
 * Pipeline:
 *   1. Load provider by slug (404 if missing, 409 if disabled).
 *   2. Re-validate configJson against ProviderConfigSchema (never trust
 *      raw DB rows).
 *   3. loadProviderSource → array of items.
 *   4. For each item, evaluate urlField (JSONPath rooted at '$') → URL
 *      string. parseGitHubUrl → owner/name or null.
 *   5. Dedupe by "owner/name".
 *   6. Compare against repositories table; classify as
 *      existing_ok | stale | new.
 *
 * Preview returns counts + a sample (first 20 non-OK).
 */

export interface PreviewTotals {
  items: number;
  urls: number;
  unique: number;
  invalid: number;
  existing: number;
  stale: number;
  new: number;
}

export interface PreviewResult {
  totals: PreviewTotals;
  sample: { owner: string; name: string }[];
}

export class ProviderNotFoundError extends Error {
  constructor(slug: string) {
    super(`provider not found: ${slug}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderDisabledError extends Error {
  constructor(slug: string) {
    super(`provider disabled: ${slug}`);
    this.name = 'ProviderDisabledError';
  }
}

const SAMPLE_LIMIT = 20;

/**
 * Applies a urlField expression (e.g. 'files[0]', 'reference', 'urls[*]')
 * to a single item, returning whatever JSONPath evaluation produces.
 * Strings and undefined are the expected outcomes; anything else is
 * coerced via String() and may end up as `[object Object]` — callers
 * downstream rely on parseGitHubUrl to filter non-strings.
 */
function evaluateUrlField(item: unknown, urlField: string): unknown {
  // urlField examples: 'files[0]', 'reference', 'urls[*]'
  // Accept both leading-'$' ($.files[0]) and bare (files[0]) syntax.
  // Bare syntax is normalized to '$' + '.' + urlField so that the
  // JSONPath evaluator starts with a property access.
  let path: string;
  if (urlField.startsWith('$')) {
    path = urlField;
  } else if (urlField.startsWith('.')) {
    path = '$' + urlField;
  } else {
    path = '$.' + urlField;
  }
  return evaluateJsonPath(item, path);
}

async function loadProviderOrThrow(slug: string) {
  const provider = await prisma.ingestionProvider.findUnique({
    where: { slug },
  });
  if (!provider) throw new ProviderNotFoundError(slug);
  if (!provider.enabled) throw new ProviderDisabledError(slug);
  return provider;
}

/**
 * Common pipeline: load provider → source → extract owner/name pairs →
 * dedupe. Returns the deduped list (capped at `limit` if given).
 */
async function extractUniquePairs(
  slug: string,
  limit: number | undefined,
): Promise<{ pairs: { owner: string; name: string }[]; itemCount: number; urlCount: number }> {
  const provider = await loadProviderOrThrow(slug);
  const config: ProviderConfig = parseProviderConfig(provider.configJson);
  const items = await loadProviderSource(config);
  const urls: string[] = [];
  for (const item of items) {
    let v: unknown;
    try {
      v = evaluateUrlField(item, config.urlField);
    } catch {
      continue;
    }
    if (typeof v === 'string' && v.length > 0) {
      urls.push(v);
    } else if (Array.isArray(v)) {
      // urlField ended in [*] — take all elements.
      for (const el of v) {
        if (typeof el === 'string' && el.length > 0) urls.push(el);
      }
    }
  }
  const pairs = urls
    .map(parseGitHubUrl)
    .filter((p): p is { owner: string; name: string } => p !== null);
  const seen = new Set<string>();
  const unique: { owner: string; name: string }[] = [];
  for (const p of pairs) {
    const key = `${p.owner}/${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  const limited = limit !== undefined ? unique.slice(0, limit) : unique;
  return { pairs: limited, itemCount: items.length, urlCount: urls.length };
}

async function classifyAgainstDb(
  pairs: { owner: string; name: string }[],
): Promise<{
  counts: Pick<PreviewTotals, 'existing' | 'stale' | 'new'>;
  status: Map<string, 'existing' | 'stale' | 'new'>;
}> {
  if (pairs.length === 0) {
    return {
      counts: { existing: 0, stale: 0, new: 0 },
      status: new Map(),
    };
  }
  const rows = await prisma.repository.findMany({
    where: { OR: pairs.map((p) => ({ owner: p.owner, name: p.name })) },
    select: {
      owner: true,
      name: true,
      fetchStatus: true,
      lastFetchedAt: true,
    },
  });
  const rowMap = new Map(rows.map((r) => [`${r.owner}/${r.name}`, r]));
  let existing = 0;
  let stale = 0;
  let fresh = 0;
  const status = new Map<string, 'existing' | 'stale' | 'new'>();
  for (const p of pairs) {
    const key = `${p.owner}/${p.name}`;
    const row = rowMap.get(key);
    if (!row) {
      fresh++;
      status.set(key, 'new');
    } else if (row.fetchStatus !== 'ok' || row.lastFetchedAt === null) {
      stale++;
      status.set(key, 'stale');
    } else {
      existing++;
      status.set(key, 'existing');
    }
  }
  return {
    counts: { existing, stale, new: fresh },
    status,
  };
}

export async function previewProvider(
  slug: string,
  opts: { limit?: number } = {},
): Promise<PreviewResult> {
  const { pairs, itemCount, urlCount } = await extractUniquePairs(slug, opts.limit);
  const { counts, status } = await classifyAgainstDb(pairs);
  // Sample shows the entries the operator should care about: stale +
  // new. Capped at SAMPLE_LIMIT, preserving input order.
  const sample: { owner: string; name: string }[] = [];
  for (const p of pairs) {
    const key = `${p.owner}/${p.name}`;
    if (status.get(key) === 'existing') continue;
    sample.push({ owner: p.owner, name: p.name });
    if (sample.length >= SAMPLE_LIMIT) break;
  }
  return {
    totals: {
      items: itemCount,
      urls: urlCount,
      unique: pairs.length,
      invalid: urlCount - pairs.length,
      ...counts,
    },
    sample,
  };
}