import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { getSourcePool } from '@/lib/import/mysql-source-pool';
import { dryRunImport } from '@/lib/import/dry-run';
import { isImportableTable } from '@/lib/import/tables';

const PostBody = z.object({
  csrf: z.string().min(1),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  password: z.string().max(255),
  database: z.string().min(1).max(64),
  tables: z.array(z.string().min(1)).min(1).max(10),
});

/**
 * POST /api/admin/import/dry-run
 *
 * Admin-only. Runs dryRunImport for each requested table against the
 * source connection. Returns one DryRunResult per table.
 *
 * Response codes:
 *   200 — { results: DryRunResult[] }
 *   403 — not admin / bad CSRF
 *   422 — malformed body or unknown table name
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

  // Every requested table must be in the whitelist. Defense in depth
  // — the form already filters, but a custom client must not bypass.
  for (const t of parsed.data.tables) {
    if (!isImportableTable(t)) {
      return apiError('bad_request', `table '${t}' is not importable`, {}, req);
    }
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
    const results = [];
    for (const table of parsed.data.tables) {
      // Cast: the isImportableTable loop above proved each entry is
      // an ImportableTable, but zod's `z.string()` keeps it as `string`
      // for TS.
      results.push(
        await dryRunImport({
          sourcePool: pool,
          table: table as unknown as Parameters<typeof dryRunImport>[0]['table'],
        }),
      );
    }
    return NextResponse.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiError('unavailable', 'dry-run failed', { details: { error: msg } }, req);
  }
}