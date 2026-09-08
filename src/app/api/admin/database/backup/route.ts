import { NextResponse } from 'next/server';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { env } from '@/lib/config/env';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import {
  createBackup,
  listBackups,
  buildBackupFilename,
  getBackupPath,
} from '@/lib/database/backup';

const PostBody = z.object({
  csrf: z.string().min(1),
});

/**
 * GET /api/admin/database/backup
 *
 * Returns the list of backup files in BACKUP_DIR, newest-first.
 * Admin-only (backups contain user hashes + webhook secrets).
 *
 * Response: { backups: [{ filename, size, mtime }] }
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }
  const backups = await listBackups();
  return NextResponse.json({
    backups: backups.map((b) => ({
      filename: b.filename,
      size: b.size,
      mtime: b.mtime.toISOString(),
    })),
    binaryStatus: getBinaryStatus(),
  });
}

/**
 * POST /api/admin/database/backup
 *
 * Triggers a new mysqldump|gzip → ./backups/. Admin-only.
 * Fails fast if the binaries aren't on PATH.
 *
 * Response codes:
 *   200 — { ok, filename, size }
 *   403 — not admin / invalid CSRF
 *   503 — binaries missing or backup spawn failed
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

  if (!binariesReady()) {
    return apiError(
      'unavailable',
      'backup binaries missing on PATH',
      { details: { binaryStatus: getBinaryStatus() } },
      req,
    );
  }

  try {
    const result = await createBackup(env.DATABASE_URL!);
    const fwd = req.headers.get('x-forwarded-for');
    void writeAudit({
      action: 'database_backup',
      targetType: 'database',
      targetId: result.filename,
      metadata: { size: result.size },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });
    return NextResponse.json({
      ok: true,
      filename: result.filename,
      size: result.size,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return apiError('unavailable', `backup failed: ${msg}`, {}, req);
  }
}

/**
 * DELETE /api/admin/database/backup?id=<filename — pre-validation already
 * applied via getBackupPath>; admin-only.
 *
 * Note: Next.js 14 App Router requires a separate file for [id] param routes.
 * This DELETE handles "delete by query param" for ergonomic fetch() calls.
 * For path-param style, see ./[id]/route.ts.
 */
export async function DELETE(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const url = new URL(req.url);
  const filename = url.searchParams.get('id');
  if (!filename) {
    return apiError('bad_request', 'missing id', {}, req);
  }
  const p = await getBackupPath(filename);
  if (!p) {
    return apiError('not_found', 'backup not found', {}, req);
  }

  await unlink(p);
  const fwd = req.headers.get('x-forwarded-for');
  void writeAudit({
    action: 'database_backup_delete',
    targetType: 'database_backup',
    targetId: filename,
    actorUserId: user.id,
    ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
  });
  return NextResponse.json({ ok: true, filename });
}

/** Used by restore UI to display "next backup will be named X". */
export const _filenameHint = buildBackupFilename;
