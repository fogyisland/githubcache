import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import {
  totalRequests,
  cacheHitRate,
  avgLatency,
  activeApiKeyCount,
  requestsOverTime,
  topRepos,
  topKeys,
  tokenQuotaUsage,
} from '@/lib/reports/queries';

/**
 * GET /api/admin/reports?window=24h
 *
 * Returns aggregated report data. Admin OR operator (read-only).
 *
 * Query params:
 *   window — '24h' (default) | '1h' | '7d'
 *
 * Response codes:
 *   200 — { kpis, overTime, topRepos, topKeys, tokenQuota }
 *   403 — not authenticated
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const window = url.searchParams.get('window') ?? '24h';
  const { from, to } = windowToRange(window);

  const [total, hitRate, avg, activeKeys, overTime, repos, keys, quota] = await Promise.all([
    totalRequests(from, to),
    cacheHitRate(from, to),
    avgLatency(from, to),
    activeApiKeyCount(from, to),
    requestsOverTime(from, to),
    topRepos(from, to, 10),
    topKeys(from, to, 10),
    tokenQuotaUsage(),
  ]);

  return NextResponse.json({
    kpis: { totalRequests: total, cacheHitRate: hitRate, avgLatencyMs: avg, activeApiKeys: activeKeys },
    overTime,
    topRepos: repos,
    topKeys: keys.map((k) => ({ ...k, keyId: k.keyId.toString() })),
    tokenQuota: quota.map((t) => ({ ...t, id: t.id.toString() })),
  });
}

function windowToRange(window: string): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  switch (window) {
    case '1h': from.setHours(from.getHours() - 1); break;
    case '7d': from.setDate(from.getDate() - 7); break;
    case '24h':
    default:   from.setHours(from.getHours() - 24); break;
  }
  return { from, to };
}