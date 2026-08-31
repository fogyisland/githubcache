import { prisma } from '@/lib/db/client';
import { evaluateJsonPath } from './jsonpath';
import { loadProviderSource } from './source';
import { parseProviderConfig, type ProviderConfig } from './schema';
import { parseGitHubUrl } from './extract';

/**
 * previewProvider / runProvider — the orchestration layer that turns a
 * provider's items into either a counts report (preview) or enqueued
 * refresh_jobs (run).
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
 * Run additionally creates refresh_jobs for every stale + new pair
 * (idempotent on repositories via upsert).
 *
 * Without a GitHub token pool, the enqueued jobs will fail at fetch
 * time with no_token_available — that's expected for the M19 testing
 * path (user has no tokens configured).
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

export interface RunResult {
  totals: PreviewTotals;
  jobCount: number;
  dryRun: boolean;
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
  staleIds: Map<string, bigint>;
}> {
  if (pairs.length === 0) {
    return {
      counts: { existing: 0, stale: 0, new: 0 },
      status: new Map(),
      staleIds: new Map(),
    };
  }
  const rows = await prisma.repository.findMany({
    where: { OR: pairs.map((p) => ({ owner: p.owner, name: p.name })) },
    select: {
      id: true,
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
  const staleIds = new Map<string, bigint>();
  for (const p of pairs) {
    const key = `${p.owner}/${p.name}`;
    const row = rowMap.get(key);
    if (!row) {
      fresh++;
      status.set(key, 'new');
    } else if (row.fetchStatus !== 'ok' || row.lastFetchedAt === null) {
      stale++;
      status.set(key, 'stale');
      staleIds.set(key, row.id);
    } else {
      existing++;
      status.set(key, 'existing');
    }
  }
  return {
    counts: { existing, stale, new: fresh },
    status,
    staleIds,
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

export async function runProvider(
  slug: string,
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<RunResult> {
  // Compute preview first so the totals match what the operator saw.
  const { pairs, itemCount, urlCount } = await extractUniquePairs(slug, opts.limit);
  const { counts, status, staleIds } = await classifyAgainstDb(pairs);
  if (opts.dryRun) {
    return {
      totals: {
        items: itemCount,
        urls: urlCount,
        unique: pairs.length,
        invalid: urlCount - pairs.length,
        ...counts,
      },
      jobCount: 0,
      dryRun: true,
    };
  }

  let jobCount = 0;
  // Enqueue for new pairs: bulk-insert stub repository rows + bulk-insert
  // refresh_jobs. Using `createMany` + `skipDuplicates` avoids the per-row
  // `$transaction` that explodes past Prisma's 5s interactive-transaction
  // timeout at ~5k rows (M20.4 hit this with the 5852-row ComfyUI batch —
  // original upsert loop took ~35s and exceeded the 5s tx limit).
  //
  // Two-step:
  //   1. Insert all stub repository rows in one createMany (skipDuplicates
  //      handles the race where another run already created them).
  //   2. Look up the new IDs by (owner, name) — only the rows we JUST
  //      inserted (skipDuplicates kept) need refresh_jobs.
  //   3. Bulk-insert the refresh_jobs in one createMany.
  const newPairs = pairs.filter(
    (p) => status.get(`${p.owner}/${p.name}`) === 'new',
  );
  if (newPairs.length > 0) {
    await prisma.repository.createMany({
      data: newPairs.map((p) => ({
        owner: p.owner,
        name: p.name,
        node: { stub: true } as never,
        fetchStatus: 'ok' as const,
      })),
      skipDuplicates: true,
    });
    const repos = await prisma.repository.findMany({
      where: { OR: newPairs.map((p) => ({ owner: p.owner, name: p.name })) },
      select: { id: true, owner: true, name: true },
    });
    const idMap = new Map(repos.map((r) => [`${r.owner}/${r.name}`, r.id]));
    const jobRows = newPairs
      .map((p) => {
        const id = idMap.get(`${p.owner}/${p.name}`);
        return id !== undefined
          ? { repositoryId: id, priority: 70, scheduledFor: new Date() }
          : null;
      })
      .filter((row): row is { repositoryId: bigint; priority: number; scheduledFor: Date } => row !== null);
    if (jobRows.length > 0) {
      await prisma.refreshJob.createMany({ data: jobRows });
      jobCount = jobRows.length;
    }
  }
  // Enqueue for stale pairs (re-fetch existing rows). Same createMany
  // pattern — these rows already exist so we can map directly from the
  // staleIds map without a re-query.
  if (staleIds.size > 0) {
    const jobRows = Array.from(staleIds.values()).map((id) => ({
      repositoryId: id,
      priority: 70,
      scheduledFor: new Date(),
    }));
    await prisma.refreshJob.createMany({ data: jobRows });
    jobCount += jobRows.length;
  }

  return {
    totals: {
      items: itemCount,
      urls: urlCount,
      unique: pairs.length,
      invalid: urlCount - pairs.length,
      ...counts,
    },
    jobCount,
    dryRun: false,
  };
}