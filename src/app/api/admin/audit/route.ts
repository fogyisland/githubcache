import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { buildAuditWhere, getActorEmails } from '@/lib/db/audit';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;
const LIMIT_DEFAULT = 50;
const EXPORT_MAX_ROWS = 100_000;

const EXPORT_FORMATS = ['csv', 'json'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];
// Reference the runtime value so ESLint doesn't flag it as a type-only
// declaration; used implicitly via `as const` narrowing.
void EXPORT_FORMATS;

const CSV_HEADER =
  'id,createdAt,action,targetType,targetId,actorUserId,actorEmail,ip,metadata';

/**
 * GET /api/admin/audit
 *
 * Query params (all optional):
 *   action        — string (exact match)
 *   actorUserId   — BigInt as string (exact match)
 *   targetType    — string (exact match)
 *   from          — ISO date (createdAt >= from)
 *   to            — ISO date (createdAt < to)
 *   limit         — 1..200 (default 50)  — JSON path only
 *   offset        — non-negative integer (default 0)  — JSON path only
 *   format        — 'csv' | 'json' (default 'json'). csv returns a
 *                   download of all matching rows (no pagination) up to
 *                   EXPORT_MAX_ROWS; json returns the same paginated
 *                   envelope as before.
 *
 * Admin only per spec §9.1.
 *
 * Response codes:
 *   200 — paginated JSON envelope (format=json) OR CSV (format=csv)
 *   400 — invalid params (incl. unknown format)
 *   403 — not admin
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const params = url.searchParams;

  let actorUserId: bigint | undefined;
  const actorParam = params.get('actorUserId');
  if (actorParam) {
    try {
      actorUserId = BigInt(actorParam);
    } catch {
      return NextResponse.json({ error: 'invalid actorUserId' }, { status: 400 });
    }
  }

  let from: Date | undefined;
  const fromParam = params.get('from');
  if (fromParam) {
    const d = new Date(fromParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid from' }, { status: 400 });
    }
    from = d;
  }

  let to: Date | undefined;
  const toParam = params.get('to');
  if (toParam) {
    const d = new Date(toParam);
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid to' }, { status: 400 });
    }
    to = d;
  }

  const formatParam = params.get('format');
  if (
    formatParam !== null &&
    formatParam !== 'csv' &&
    formatParam !== 'json'
  ) {
    return NextResponse.json({ error: 'invalid format' }, { status: 400 });
  }
  const format: ExportFormat = formatParam === 'csv' ? 'csv' : 'json';

  const where = buildAuditWhere({
    ...(params.get('action') ? { action: params.get('action')! } : {}),
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(params.get('targetType') ? { targetType: params.get('targetType')! } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  if (format === 'csv') {
    return exportCsv(where);
  }

  // Default JSON path — unchanged behavior.
  let limit = Number(params.get('limit') ?? LIMIT_DEFAULT);
  if (!Number.isFinite(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    return NextResponse.json({ error: 'invalid limit' }, { status: 400 });
  }
  let offset = Number(params.get('offset') ?? 0);
  if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
    return NextResponse.json({ error: 'invalid offset' }, { status: 400 });
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter((id): id is bigint => id !== null)),
  ];
  const emails = await getActorEmails(actorIds);

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      id: r.id.toString(),
      actorUserId: r.actorUserId?.toString() ?? null,
      actorEmail: r.actorUserId ? (emails.get(r.actorUserId) ?? null) : null,
    })),
    total,
    limit,
    offset,
  });
}

/**
 * Build a CSV download of every audit row matching `where`, ordered
 * createdAt DESC, capped at EXPORT_MAX_ROWS. The file is self-contained:
 * actor emails are enriched in-process so no second lookup is needed.
 *
 * `X-Total-Rows` carries the true count (caller learns about truncation
 * before parsing the body). A `# truncated` trailer line is appended when
 * the export was capped, since CSV (RFC 4180) has no standard comment.
 */
async function exportCsv(where: Prisma.AuditLogWhereInput): Promise<Response> {
  const total = await prisma.auditLog.count({ where });
  const truncated = total > EXPORT_MAX_ROWS;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: EXPORT_MAX_ROWS,
  });

  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter((id): id is bigint => id !== null)),
  ];
  const emails = await getActorEmails(actorIds);

  const body =
    CSV_HEADER +
    '\n' +
    rows
      .map((r) => {
        const actorEmail = r.actorUserId ? (emails.get(r.actorUserId) ?? '') : '';
        return csvLine([
          r.id.toString(),
          r.createdAt.toISOString(),
          r.action,
          r.targetType ?? '',
          r.targetId ?? '',
          r.actorUserId?.toString() ?? '',
          actorEmail,
          r.ip ?? '',
          JSON.stringify(r.metadata ?? {}),
        ]);
      })
      .join('\n') +
    (truncated ? `\n# truncated; ${total} rows match, exported ${rows.length}\n` : '\n');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="audit-${stamp}.csv"`,
      'x-total-rows': String(total),
      'x-exported-rows': String(rows.length),
      'x-truncated': truncated ? '1' : '0',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Format a single CSV row, escaping per RFC 4180: any field containing
 * `,`, `"`, or newline is wrapped in double quotes with embedded quotes
 * doubled. null/undefined become empty string.
 */
function csvLine(fields: Array<string | null | undefined>): string {
  return fields
    .map((f) => {
      const s = f ?? '';
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(',');
}