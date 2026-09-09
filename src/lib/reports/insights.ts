import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * Insights aggregations over the `repositories` cache (M18).
 *
 * Five numbers / lists tell the operator what the cached GitHub metadata
 * actually looks like:
 *   - topRepos({skip, take, language?, sortBy}): paginated list of cached
 *     repos sorted by a metadata field (stars / forks / watchers / updated).
 *     Uses MySQL JSON expressions so the sort/filter happens at the DB layer
 *     rather than pulling every row into Node.
 *   - languageDistribution(limit): top N languages by repo count among the
 *     `fetch_status = 'ok'` rows that have a non-null `metadata.language`.
 *   - staleRepos({thresholdDays, skip, take}): paginated list of repos whose
 *     `last_fetched_at` is older than the threshold, oldest first.
 *   - fetchStatusBreakdown(): how many cached repos sit in each terminal
 *     fetch_status today (same shape as `repositoryFetchBreakdown` in
 *     `ingestion.ts`, kept as a separate export to avoid coupling the
 *     insights page to M16's ingestion module).
 *   - recentFetchFailures({skip, take}): paginated list of repos in any
 *     non-OK fetch_status, most-recently-fetched first. Used by the
 *     "Fetch health" page to surface the recent failures list.
 *
 * All raw SQL uses mapped column names (`last_fetched_at`, `fetch_status`)
 * to match the Prisma `@@map` directives — see the existing convention in
 * `src/lib/reports/ingestion.ts` and the memory `feedback_prisma_at_map_raw_sql`.
 */

export type InsightsSortKey =
  | 'stars'
  | 'forks'
  | 'watchers'
  | 'updated_at'
  | 'last_fetched_at';

export const INSIGHTS_SORT_KEYS: readonly InsightsSortKey[] = [
  'stars',
  'forks',
  'watchers',
  'updated_at',
  'last_fetched_at',
];

export function isInsightsSortKey(value: unknown): value is InsightsSortKey {
  return (
    typeof value === 'string' &&
    (INSIGHTS_SORT_KEYS as readonly string[]).includes(value)
  );
}

/**
 * One row from the top-repos listing. The metadata JSON is exposed in
 * raw form (the caller can pass it through `src/lib/repo/metadata.ts`
 * helpers if it needs typed access) so the helper doesn't double-parse.
 */
export interface TopRepoRow {
  id: bigint;
  owner: string;
  name: string;
  fetchStatus: 'ok' | 'not_found' | 'forbidden' | 'error';
  lastFetchedAt: Date | null;
  metadata: Prisma.JsonValue;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  language: string | null;
  license: string | null;
  updatedAt: string | null;
}

export interface TopReposArgs {
  skip: number;
  take: number;
  language?: string;
  sortBy?: InsightsSortKey;
}

export interface TopReposResult {
  rows: TopRepoRow[];
  total: number;
  sortBy: InsightsSortKey;
  language: string | null;
}

/**
 * Top cached repos, ordered by the chosen metadata field. Only `ok` repos
 * with non-null `metadata` are considered — that is, repos we successfully
 * fetched from GitHub at least once.
 *
 * The `language` filter compares against `JSON_UNQUOTE(JSON_EXTRACT(...))`
 * because MySQL JSON-extracted strings come back quoted and compared case
 * sensitively against the parameter.
 *
 * Sorting uses `CAST(... AS UNSIGNED)` for the numeric fields so MySQL can
 * use the expression as an index-friendly order key; `updated_at` and
 * `last_fetched_at` sort by the underlying columns directly.
 */
export async function topRepos(args: TopReposArgs): Promise<TopReposResult> {
  const sortBy: InsightsSortKey = args.sortBy ?? 'stars';
  const language = args.language ?? null;

  // Build the WHERE clause imperatively so we can add the language filter
  // conditionally without concatenating strings. Both queries share the
  // same shape; only the trailing `ORDER BY ... LIMIT` differs.
  const baseWhere = `fetch_status = 'ok' AND metadata IS NOT NULL`;

  let orderExpr: string;
  if (sortBy === 'updated_at') {
    orderExpr = 'JSON_UNQUOTE(JSON_EXTRACT(metadata, \'$.updatedAt\')) DESC';
  } else if (sortBy === 'last_fetched_at') {
    orderExpr = 'last_fetched_at DESC';
  } else if (sortBy === 'forks') {
    orderExpr = 'CAST(JSON_EXTRACT(metadata, \'$.forks\') AS UNSIGNED) DESC';
  } else if (sortBy === 'watchers') {
    orderExpr = 'CAST(JSON_EXTRACT(metadata, \'$.watchers\') AS UNSIGNED) DESC';
  } else {
    orderExpr = 'CAST(JSON_EXTRACT(metadata, \'$.stars\') AS UNSIGNED) DESC';
  }

  const languageFilter = language
    ? `AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.language')) = ${JSON.stringify(language)}`
    : '';

  type RawRow = {
    id: bigint;
    owner: string;
    name: string;
    fetch_status: 'ok' | 'not_found' | 'forbidden' | 'error';
    last_fetched_at: Date | null;
    metadata: Prisma.JsonValue;
    stars: bigint | null;
    forks: bigint | null;
    watchers: bigint | null;
    language: string | null;
    license_name: string | null;
    updated_at_str: string | null;
  };

  const [rows, totalRow] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      SELECT
        id,
        owner,
        name,
        fetch_status,
        last_fetched_at,
        metadata,
        CAST(JSON_EXTRACT(metadata, '$.stars') AS UNSIGNED) AS stars,
        CAST(JSON_EXTRACT(metadata, '$.forks') AS UNSIGNED) AS forks,
        CAST(JSON_EXTRACT(metadata, '$.watchers') AS UNSIGNED) AS watchers,
        JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.language')) AS language,
        JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.license')) AS license_name,
        JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.updatedAt')) AS updated_at_str
      FROM repositories
      WHERE ${Prisma.raw(baseWhere)} ${Prisma.raw(languageFilter)}
      ORDER BY ${Prisma.raw(orderExpr)}
      LIMIT ${args.take} OFFSET ${args.skip}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM repositories
      WHERE ${Prisma.raw(baseWhere)} ${Prisma.raw(languageFilter)}
    `,
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      fetchStatus: r.fetch_status,
      lastFetchedAt: r.last_fetched_at,
      metadata: r.metadata,
      stars: r.stars === null ? null : Number(r.stars),
      forks: r.forks === null ? null : Number(r.forks),
      watchers: r.watchers === null ? null : Number(r.watchers),
      language: r.language,
      license: r.license_name,
      updatedAt: r.updated_at_str,
    })),
    total: Number(totalRow[0]?.count ?? 0n),
    sortBy,
    language,
  };
}

export interface DistributionBucket {
  key: string;
  count: number;
  sharePct: number;
}

/**
 * Top N languages by repo count, restricted to `ok` repos with a known
 * language. Returns buckets sorted by `count` desc, with `sharePct` rounded
 * to 1 decimal so the UI can render `"43.2%"`.
 *
 * Empty `''` language values are filtered out at the SQL layer — those
 * represent repos GitHub has not classified.
 */
export async function languageDistribution(limit: number): Promise<DistributionBucket[]> {
  type RawBucket = { language: string; count: bigint };
  // Derived table wrapper avoids MySQL only_full_group_by rejection: the
  // outer GROUP BY language then sees a real column, not a JSON expression
  // that's only functionally dependent on `metadata`.
  const rows = await prisma.$queryRaw<RawBucket[]>`
    SELECT language, COUNT(*) AS count
    FROM (
      SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.language')) AS language
      FROM repositories
      WHERE fetch_status = 'ok' AND metadata IS NOT NULL
    ) t
    WHERE language <> ''
    GROUP BY language
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  const total = rows.reduce((acc, r) => acc + Number(r.count), 0);
  return rows.map((r) => ({
    key: r.language,
    count: Number(r.count),
    sharePct: total === 0 ? 0 : Math.round((Number(r.count) / total) * 1000) / 10,
  }));
}

/**
 * Distinct languages present in `ok` cached repos — used to populate the
 * language filter on the top-repos page. Same SQL restriction as
 * `languageDistribution` so the two views agree on what counts as a
 * "language".
 */
export async function distinctLanguages(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ language: string }>>`
    SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.language')) AS language
    FROM repositories
    WHERE fetch_status = 'ok'
      AND metadata IS NOT NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.language')) <> ''
    ORDER BY language ASC
  `;
  return rows.map((r) => r.language);
}

export interface StaleRepoRow {
  id: bigint;
  owner: string;
  name: string;
  fetchStatus: 'ok' | 'not_found' | 'forbidden' | 'error';
  lastFetchedAt: Date;
  ageDays: number;
  fetchError: string | null;
}

export interface StaleReposArgs {
  thresholdDays: number;
  skip: number;
  take: number;
}

export interface StaleReposResult {
  rows: StaleRepoRow[];
  total: number;
  thresholdDays: number;
  cutoff: Date;
}

/**
 * Repos whose `last_fetched_at` is older than `thresholdDays` days, oldest
 * first. Includes the `ageDays` derived value so the UI doesn't have to
 * compute the difference for every row.
 *
 * `last_fetched_at IS NOT NULL` is required — repos we've never successfully
 * fetched have no meaningful staleness.
 */
export async function staleRepos(args: StaleReposArgs): Promise<StaleReposResult> {
  const cutoff = new Date(Date.now() - args.thresholdDays * 24 * 60 * 60 * 1000);

  type RawRow = {
    id: bigint;
    owner: string;
    name: string;
    fetch_status: 'ok' | 'not_found' | 'forbidden' | 'error';
    last_fetched_at: Date;
    fetch_error: string | null;
  };

  const [rows, totalRow] = await Promise.all([
    prisma.$queryRaw<RawRow[]>`
      SELECT id, owner, name, fetch_status, last_fetched_at, fetch_error
      FROM repositories
      WHERE last_fetched_at IS NOT NULL
        AND last_fetched_at < ${cutoff}
      ORDER BY last_fetched_at ASC
      LIMIT ${args.take} OFFSET ${args.skip}
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM repositories
      WHERE last_fetched_at IS NOT NULL
        AND last_fetched_at < ${cutoff}
    `,
  ]);

  const total = Number(totalRow[0]?.count ?? 0n);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      fetchStatus: r.fetch_status,
      lastFetchedAt: r.last_fetched_at,
      ageDays: Math.floor((Date.now() - r.last_fetched_at.getTime()) / (24 * 60 * 60 * 1000)),
      fetchError: r.fetch_error,
    })),
    total,
    thresholdDays: args.thresholdDays,
    cutoff,
  };
}

export interface FetchStatusBreakdown {
  ok: number;
  not_found: number;
  forbidden: number;
  error: number;
}

/**
 * Count of cached repos in each terminal `fetch_status`. The four values
 * sum to `prisma.repository.count()` — every cached row has exactly one of
 * these states. Mirrors the shape used in `reports/ingestion.ts` so the
 * health page can render the same KPI strip.
 */
export async function fetchStatusBreakdown(): Promise<FetchStatusBreakdown> {
  const rows = await prisma.$queryRaw<
    Array<{ fetch_status: 'ok' | 'not_found' | 'forbidden' | 'error'; count: bigint }>
  >`
    SELECT fetch_status, COUNT(*) AS count
    FROM repositories
    GROUP BY fetch_status
  `;
  const out: FetchStatusBreakdown = { ok: 0, not_found: 0, forbidden: 0, error: 0 };
  for (const r of rows) {
    out[r.fetch_status] = Number(r.count);
  }
  return out;
}

export interface FailedRepoRow {
  id: bigint;
  owner: string;
  name: string;
  fetchStatus: 'not_found' | 'forbidden' | 'error';
  lastFetchedAt: Date;
  fetchError: string | null;
}

export interface RecentFailuresResult {
  rows: FailedRepoRow[];
  total: number;
}

/**
 * Recently fetched repos in a non-OK state. Most-recently-fetched first.
 * Used by the fetch-health page to show operators what just broke without
 * forcing them to drill into the audit log.
 */
export async function recentFetchFailures(args: {
  skip: number;
  take: number;
}): Promise<RecentFailuresResult> {
  const baseWhere: Prisma.RepositoryWhereInput = {
    fetchStatus: { in: ['not_found', 'forbidden', 'error'] },
    lastFetchedAt: { not: null },
  };

  const [rows, total] = await Promise.all([
    prisma.repository.findMany({
      where: baseWhere,
      orderBy: { lastFetchedAt: 'desc' },
      skip: args.skip,
      take: args.take,
      select: {
        id: true,
        owner: true,
        name: true,
        fetchStatus: true,
        lastFetchedAt: true,
        fetchError: true,
      },
    }),
    prisma.repository.count({ where: baseWhere }),
  ]);

  return {
    rows: rows.map((r) => {
      // The select narrows `fetchStatus` to the failure subset; cast back
      // to the union the rest of the codebase uses.
      const status = r.fetchStatus as 'not_found' | 'forbidden' | 'error';
      // lastFetchedAt is asserted non-null via the where filter above.
      const lastFetchedAt = r.lastFetchedAt as Date;
      return {
        id: r.id,
        owner: r.owner,
        name: r.name,
        fetchStatus: status,
        lastFetchedAt,
        fetchError: r.fetchError,
      };
    }),
    total,
  };
}
