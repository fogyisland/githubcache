import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { apiError } from '@/lib/api/errors';
import { getSourcePool } from '@/lib/import/mysql-source-pool';
import { applyImport, MAX_ROWS_PER_APPLY } from '@/lib/import/apply';
import { isImportableTable, type ImportableTable } from '@/lib/import/tables';
import { writeAudit } from '@/lib/audit/writer';

const CONFIRM_WORD = 'IMPORT';

const PostBody = z.object({
  csrf: z.string().min(1),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1).max(64),
  password: z.string().max(255),
  database: z.string().min(1).max(64),
  tables: z.array(z.string().min(1)).min(1).max(10),
  confirm: z.string(),
});

/**
 * POST /api/admin/import/apply
 *
 * Admin-only. Applies INSERT IGNORE for each requested table.
 * Returns apply results + the audit IDs that were written.
 *
 * Confirm word: caller must send `confirm: 'IMPORT'`.
 * Single-flight: two concurrent applies on the same source return the
 * same Promise (no double-write).
 *
 * Response codes:
 *   200 — { results: ApplyResult[], auditIds: BigInt[] }
 *   403 — not admin / bad CSRF
 *   422 — bad body / wrong confirm word
 *   503 — apply failed (e.g., FK violation)
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
  if (parsed.data.confirm !== CONFIRM_WORD) {
    return apiError('forbidden', `confirm word must be '${CONFIRM_WORD}'`, {}, req);
  }

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
  // Source key: same MySQL instance + database = same import job.
  // Used by the in-process mutex for single-flight.
  const sourceKey = `${spec.host}:${spec.port}/${spec.database}`;

  let pool;
  try {
    pool = await getSourcePool(spec);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiError('unauthorized', 'source connection failed', { details: { error: msg } }, req);
  }

  try {
    // `parsed.data.tables` is `string[]` from zod, but the per-table
    // whitelist check above (and in isImportableTable) narrowed it to
    // ImportableTable[] — cast through unknown for TS.
    const tables = parsed.data.tables as unknown as ImportableTable[];
    const results = await applyImport({
      sourcePool: pool,
      tables,
      sourceKey,
      maxRows: MAX_ROWS_PER_APPLY,
    });

    // One audit row per table — keeps the audit trail queryable by
    // table name (action='import_<table>').
    const auditIds: bigint[] = [];
    const fwd = req.headers.get('x-forwarded-for');
    for (const r of results) {
      const audit = await writeAudit({
        action: `import_${r.table}`,
        targetType: r.table,
        targetId: 'bulk',
        metadata: {
          inserted: r.inserted,
          skipped: r.skipped,
          failed: r.failed,
          sourceDbHost: spec.host,
          sourceDbName: spec.database,
        },
        actorUserId: user.id,
        ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
      });
      auditIds.push(audit.id);
    }

    return NextResponse.json({ results, auditIds: auditIds.map((id) => id.toString()) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiError('unavailable', 'apply failed', { details: { error: msg } }, req);
  }
}