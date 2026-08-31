import { NextResponse } from 'next/server';
import { writeFile, unlink, stat } from 'node:fs/promises';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { verifyCsrf } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';
import { apiError } from '@/lib/api/errors';
import { performRestore, tempUploadPath, ensureUploadDirExists } from '@/lib/database/restore';
import { getBinaryStatus, binariesReady } from '@/lib/database/binary-check';
import { listBackups } from '@/lib/database/backup';

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MiB hard cap
const CONFIRM_WORD = 'RESTORE';

/**
 * POST /api/admin/database/restore
 *
 * Restores the DB from a backup. Two modes via Content-Type:
 *
 *   1. application/json — { csrf, mode: 'backup', filename }
 *      Restore from an existing file in BACKUP_DIR.
 *
 *   2. multipart/form-data — csrf, mode='upload', confirm, file
 *      Upload a .sql.gz file and restore from it.
 *
 * `confirm` must equal "RESTORE" (uppercase). Without it the route
 * 400s even with valid auth.
 *
 * Admin-only. Audit-logged with the source filename + table count.
 *
 * Response codes:
 *   200 — { ok, preRestoreBackup, tableCount }
 *   400 — missing fields / bad confirm word
 *   403 — not admin / invalid CSRF
 *   413 — upload too large
 *   503 — binaries missing or restore failed
 */
export async function POST(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  if (!binariesReady()) {
    return apiError(
      'unavailable',
      'backup binaries missing on PATH',
      { details: { binaryStatus: getBinaryStatus() } },
      req,
    );
  }

  const contentType = req.headers.get('content-type') ?? '';
  let source:
    | { kind: 'backup'; filename: string }
    | { kind: 'upload'; absolutePath: string };
  let csrfToken: string | null = null;
  let confirm: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) return apiError('bad_request', 'invalid form', {}, req);
    csrfToken = stringField(form, 'csrf');
    confirm = stringField(form, 'confirm');
    const file = form.get('file');
    if (!(file instanceof File)) {
      return apiError('bad_request', 'missing file', {}, req);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return apiError('payload_too_large', `upload exceeds ${MAX_UPLOAD_BYTES} bytes`, {}, req);
    }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await ensureUploadDirExists();
    const dest = tempUploadPath(uploadId);
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(dest, buf);
    source = { kind: 'upload', absolutePath: dest };
  } else {
    const body = (await req.json().catch(() => null)) as
      | { csrf?: unknown; mode?: unknown; filename?: unknown; confirm?: unknown }
      | null;
    if (!body) return apiError('bad_request', 'invalid body', {}, req);
    csrfToken = typeof body.csrf === 'string' ? body.csrf : null;
    confirm = typeof body.confirm === 'string' ? body.confirm : null;
    if (body.mode !== 'backup' || typeof body.filename !== 'string') {
      return apiError('bad_request', 'mode must be backup + filename', {}, req);
    }
    // Defensive: filename must exist in our known list
    const known = await listBackups();
    if (!known.find((k) => k.filename === body.filename)) {
      return apiError('not_found', 'backup not found', {}, req);
    }
    source = { kind: 'backup', filename: body.filename };
  }

  if (!csrfToken || !verifyCsrf(req, csrfToken)) {
    return apiError('forbidden', 'invalid csrf', {}, req);
  }
  if (confirm !== CONFIRM_WORD) {
    return apiError(
      'bad_request',
      `confirm must equal "${CONFIRM_WORD}"`,
      {},
      req,
    );
  }

  try {
    const result = await performRestore({ source, actorUserId: user.id });
    const fwd = req.headers.get('x-forwarded-for');
    void writeAudit({
      action: 'database_restore',
      targetType: 'database',
      targetId: result.rollbackFilename,
      metadata: {
        source,
        tableCount: result.tableCount,
        preRestoreBackup: result.preRestoreBackup,
      },
      actorUserId: user.id,
      ...(fwd !== null && fwd !== '' ? { ip: fwd } : {}),
    });

    // For upload mode, clean up the temp file now that it's been
    // gunzip-imported. Best-effort — failure is non-fatal.
    if (source.kind === 'upload') {
      void unlink(source.absolutePath).catch(() => undefined);
    }

    return NextResponse.json({
      ok: true,
      preRestoreBackup: result.preRestoreBackup,
      tableCount: result.tableCount,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // For upload mode on failure, also clean up
    if (source.kind === 'upload') {
      try {
        const s = await stat(source.absolutePath);
        if (s.isFile()) await unlink(source.absolutePath);
      } catch {
        // already gone
      }
    }
    void writeAudit({
      action: 'database_restore_failed',
      targetType: 'database',
      targetId: 'unknown',
      metadata: { source, error: msg },
      actorUserId: user.id,
    }).catch(() => undefined);
    return apiError('unavailable', `restore failed: ${msg}`, {}, req);
  }
}

function stringField(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === 'string' && v !== '' ? v : null;
}
