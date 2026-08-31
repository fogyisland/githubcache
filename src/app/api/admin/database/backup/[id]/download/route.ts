import { createReadStream } from 'node:fs';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { apiError } from '@/lib/api/errors';
import { getBackupPath } from '@/lib/database/backup';

/**
 * GET /api/admin/database/backup/[id]/download
 *
 * Streams a .sql.gz file from BACKUP_DIR to the browser as
 * application/gzip with Content-Disposition: attachment.
 *
 * Admin-only. The filename goes through getBackupPath() which
 * rejects path traversal (anything with /, \, or ..).
 *
 * Response codes:
 *   200 — file stream
 *   400 — invalid filename (path traversal attempt or wrong extension)
 *   403 — not admin
 *   404 — backup does not exist
 */
export async function GET(
  req: Request,
  ctx: { params: { id: string } },
): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user || user.role !== 'admin') {
    return apiError('forbidden', 'forbidden', {}, req);
  }

  const abs = await getBackupPath(ctx.params.id);
  if (!abs) {
    return apiError('not_found', 'backup not found', {}, req);
  }

  const stream = createReadStream(abs);
  // Convert Node Readable to web ReadableStream so Next.js can serve it.
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${ctx.params.id}"`,
      // Disable caching — a backup taken at T+0 is a different artifact
      // from one taken at T+60s even if the name collides.
      'Cache-Control': 'no-store',
    },
  });
}
