import type { User, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * List users (admin view), newest first. Returns a page + the total
 * matching count so callers can render pagination controls. M14.2
 * replaced the unbounded `listUsers()` shape — callers that need the
 * full list (e.g. session-all enumeration) should set a high `take`.
 *
 * M26 — accepts an optional `signupSource` filter so /admin/users can
 * split self-signups from admin-invites.
 */
export async function listUsers(opts: {
  role?: 'admin' | 'operator';
  status?: 'active' | 'disabled';
  signupSource?: 'invited' | 'self';
  skip: number;
  take: number;
}): Promise<{ rows: User[]; total: number }> {
  const where: Prisma.UserWhereInput = {};
  if (opts.role) where.role = opts.role;
  if (opts.status) where.status = opts.status;
  if (opts.signupSource) where.signupSource = opts.signupSource;
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Look up a single user by primary key. Returns null if not found.
 */
export async function getUserById(id: bigint): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Update a user's status (active / disabled). No cascade — does not
 * invalidate sessions. The caller is responsible for that (e.g., the
 * logout-all endpoint invalidates sessions explicitly).
 *
 * M27.7 — wraps the UPDATE in a `$transaction` with a `SET @app_source`
 * so the AFTER UPDATE trigger on `users` can distinguish application
 * writes from manual SQL. Prisma 5 routes a `$transaction([])` array
 * through a single connection, so the session variable set in step 1
 * is visible to the UPDATE in step 2 — and to the trigger that fires
 * off that UPDATE.
 *
 * M28.bug4a — also `SET @app_actor` so the trigger can stamp
 * `audit_log.actor_user_id`. Required: actorUserId > 0 (the route
 * layer rejects anonymous disable, and the trigger stamps 0 for
 * out-of-band writes so the NOT NULL constraint holds).
 */
export async function updateUserStatus(
  id: bigint,
  status: 'active' | 'disabled',
  actorUserId: bigint,
): Promise<void> {
  if (actorUserId <= 0n) {
    throw new Error('updateUserStatus requires a positive actorUserId');
  }
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET @app_source = 'application'"),
    prisma.$executeRawUnsafe(`SET @app_actor = '${actorUserId.toString()}'`),
    prisma.user.update({ where: { id }, data: { status } }),
  ]);
}
