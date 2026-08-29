import { NextResponse } from 'next/server';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { validateSession } from '@/lib/auth/session';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { apiError } from '@/lib/api/errors';

/**
 * GET /api/admin/palette
 *
 * Command-palette data payload (M11.5 → M11.7). Returns:
 *   - sections — sidebar section list (7 fixed sections)
 *   - recentAudit — last 5 audit entries (used for jump-to-actor)
 *
 * Auth: any authenticated operator/admin.
 *
 * Response codes:
 *   200 — palette payload
 *   401 — not signed in
 */
export async function GET(req: Request): Promise<Response> {
  const cookies = cookiesFromRequest(req);
  const user = await validateSession({ headers: req.headers, cookies });
  if (!user) {
    return apiError('unauthorized', 'unauthorized', {}, req);
  }

  const { rows } = await queryAuditLog({ limit: 5, offset: 0 });
  const actorIds = [
    ...new Set(rows.map((r) => r.actorUserId).filter((id): id is bigint => id !== null)),
  ];
  const emails = await getActorEmails(actorIds);

  const sections = [
    { slug: 'dashboard', title: 'Dashboard', icon: '◉', roles: ['admin', 'operator'] },
    { slug: 'users', title: 'Users', icon: '◐', roles: ['admin'] },
    { slug: 'api-keys', title: 'API Keys', icon: '⌬', roles: ['admin', 'operator'] },
    { slug: 'github-tokens', title: 'GitHub Tokens', icon: '⊕', roles: ['admin', 'operator'] },
    { slug: 'reports', title: 'Reports', icon: '⊟', roles: ['admin', 'operator'] },
    { slug: 'audit', title: 'Audit', icon: '◭', roles: ['admin'] },
    { slug: 'refresh', title: 'Refresh', icon: '↻', roles: ['admin'] },
  ];

  return NextResponse.json({
    sections: sections.filter((s) => s.roles.includes(user.role)),
    recentAudit: rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      actor: r.actorUserId ? (emails.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}