import { prisma } from '@/lib/db/client';

export interface RequestsOverTimeBucket {
  hour: Date;
  cacheHits: number;
  cacheMisses: number;
}

export async function requestsOverTime(
  from: Date,
  to: Date,
): Promise<RequestsOverTimeBucket[]> {
  // MySQL 5.7: DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') for hourly buckets
  // Use Prisma $queryRaw — return type is unknown[], narrow manually
  const rows = await prisma.$queryRaw<Array<{ hour: Date; cacheHits: bigint | number; cacheMisses: bigint | number }>>`
    SELECT
      DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') AS hour,
      SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cacheHits,
      SUM(CASE WHEN cache_hit = 0 THEN 1 ELSE 0 END) AS cacheMisses
    FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return rows.map((r) => ({
    hour: new Date(r.hour),
    cacheHits: Number(r.cacheHits),
    cacheMisses: Number(r.cacheMisses),
  }));
}

export async function totalRequests(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
  `;
  return Number(rows[0]?.count ?? 0n);
}

export async function cacheHitRate(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ hits: bigint; total: bigint }>>`
    SELECT
      SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS hits,
      COUNT(*) AS total
    FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
  `;
  const total = Number(rows[0]?.total ?? 0n);
  if (total === 0) return 0;
  return Number(rows[0]?.hits ?? 0n) / total;
}

export async function avgLatency(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ avg: unknown }>>`
    SELECT AVG(duration_ms) AS avg FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
  `;
  const v = rows[0]?.avg;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  // Prisma returns Decimal for AVG — coerce via String()
  return Number(String(v));
}

export async function activeApiKeyCount(from: Date, to: Date): Promise<number> {
  return prisma.requestLog.findMany({
    where: { createdAt: { gte: from, lt: to }, apiKeyId: { not: null } },
    distinct: ['apiKeyId'],
    select: { apiKeyId: true },
  }).then((rows) => rows.length);
}

export interface TopRepo {
  repo: string;
  requestCount: number;
  hitRate: number;
}

export async function topRepos(from: Date, to: Date, limit: number): Promise<TopRepo[]> {
  const rows = await prisma.$queryRaw<Array<{ repo: string; total: bigint; hits: bigint }>>`
    SELECT
      repo_requested AS repo,
      COUNT(*) AS total,
      SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS hits
    FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
      AND repo_requested IS NOT NULL
    GROUP BY repo_requested
    ORDER BY total DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    const total = Number(r.total);
    const hits = Number(r.hits);
    return {
      repo: r.repo,
      requestCount: total,
      hitRate: total === 0 ? 0 : hits / total,
    };
  });
}

export interface TopKey {
  keyId: bigint;
  label: string;
  requestCount: number;
  lastUsed: Date | null;
}

export async function topKeys(from: Date, to: Date, limit: number): Promise<TopKey[]> {
  const rows = await prisma.$queryRaw<Array<{ api_key_id: bigint; total: bigint; last_used: Date }>>`
    SELECT
      api_key_id,
      COUNT(*) AS total,
      MAX(created_at) AS last_used
    FROM request_log
    WHERE created_at >= ${from} AND created_at < ${to}
      AND api_key_id IS NOT NULL
    GROUP BY api_key_id
    ORDER BY total DESC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return [];
  const keyIds = rows.map((r) => r.api_key_id);
  const keys = await prisma.apiKey.findMany({
    where: { id: { in: keyIds } },
    select: { id: true, name: true },
  });
  const labelMap = new Map(keys.map((k) => [k.id, k.name]));
  return rows.map((r) => ({
    keyId: r.api_key_id,
    label: labelMap.get(r.api_key_id) ?? '(deleted)',
    requestCount: Number(r.total),
    lastUsed: r.last_used,
  }));
}

export interface TokenQuota {
  id: bigint;
  label: string;
  status: string;
  requestsUsed: number;
  requestsLimit: number;
  resetAt: Date | null;
}

export async function tokenQuotaUsage(): Promise<TokenQuota[]> {
  const tokens = await prisma.githubToken.findMany({
    orderBy: { requestsUsed: 'desc' },
    select: {
      id: true,
      label: true,
      status: true,
      requestsUsed: true,
      requestsLimit: true,
      resetAt: true,
    },
  });
  return tokens;
}