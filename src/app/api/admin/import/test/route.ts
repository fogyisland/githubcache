import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { closeSourcePool, getSourcePool } from '@/lib/import/mysql-source-pool';
import { IMPORTABLE_TABLES } from '@/lib/import/tables';

const PostBody = z.object({
  csrf: z.string().min(1),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  password: z.string().max(255),
  database: z.string().min(1).max(64),
});

/**
 * POST /api/admin/import/test
 *
 * Admin-only. Opens a pool against the source spec and:
 *   1. Pings the connection (fail-fast on bad creds).
 *   2. Lists databases (SHOW DATABASES).
 *   3. Filters IMPORTABLE_TABLES down to ones that actually exist in
 *      the source's `database`.
 *
 * Response codes:
 *   200 — { ok: true, databases, tables: string[] }
 *   401 — bad connection / auth failed
 *   403 — not admin / bad CSRF
 *   422 — malformed spec
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return apiError('bad_request', 'invalid body', {}, req);
  }
  if (!verifyCsrf(req, parsed.data.csrf)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }

  const spec = {
    host: parsed.data.host,
    port: parsed.data.port,
    user: parsed.data.user,
    password: parsed.data.password,
    database: parsed.data.database,
  };

  try {
    const pool = await getSourcePool(spec);
    // SHOW DATABASES — we surface this so the user can see they
    // connected to the right server.
    type DbRow = RowDataPacket & { Database?: string };
    const [dbRows] = await pool.query<DbRow[]>('SHOW DATABASES');
    const databases = dbRows
      .map((r) => (r.Database ?? r['Database']) as string | undefined)
      .filter((s): s is string => typeof s === 'string');

    // Probe each whitelisted table for existence. INFORMATION_SCHEMA
    // is the right place — it avoids per-table query overhead.
    const tablePlaceholders = IMPORTABLE_TABLES.map(() => '?').join(', ');
    type TblRow = RowDataPacket & { TABLE_NAME?: string };
    const [tblRows] = await pool.query<TblRow[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${tablePlaceholders})`,
      [spec.database, ...IMPORTABLE_TABLES],
    );
    const present = new Set(
      tblRows.map((r) => (r.TABLE_NAME ?? r['TABLE_NAME']) as string | undefined),
    );
    const tables = IMPORTABLE_TABLES.filter((t) => present.has(t));

    return NextResponse.json({ ok: true, databases, tables });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Pool stays in cache for the next apply; only invalidate if the
    // user is fixing their spec. We don't aggressively close here.
    await closeSourcePool(spec).catch(() => {
      // ignore
    });
    return apiError('unauthorized', 'source connection failed', { details: { error: msg } }, req);
  }
}