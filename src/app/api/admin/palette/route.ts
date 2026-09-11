import { NextResponse } from 'next/server';
import { requireAdminFromRequest } from '@/lib/auth/require-admin';
import { loadPaletteData } from '@/lib/admin/palette-loader';

/**
 * GET /api/admin/palette
 *
 * Command-palette data payload. Returns:
 *   - sections — sidebar section list (role-filtered)
 *   - recentAudit — last 5 audit entries (used for jump-to-actor)
 *   - indexed — flat detail-page hits (recent 20 users, etc.) so
 *     "user 42" / "alice" resolve to /admin/users/42
 *
 * Auth: any authenticated admin. The previous M11.5 stub allowed
 * any authenticated operator — Task 2 tightens to admin only
 * because the route exposes the user id + email list, and the
 * palette itself only opens for admins (it lives under /admin/*).
 * See `requireAdminFromRequest` for the auth gate.
 *
 * Response codes:
 *   200 — palette payload
 *   401 — not signed in
 *   403 — not admin
 *
 * M30 — Task 2 replaces the M11.5 stub (which built the payload
 * inline) with a call into `loadPaletteData()`. The previous commit
 * (Task 1, d6c9763) left the M11.5 stub in place pending this work.
 */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdminFromRequest(req);
  if (!auth.ok) return auth.response;

  const data = await loadPaletteData(auth.user.role);
  return NextResponse.json(data);
}
