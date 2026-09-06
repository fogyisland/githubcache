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
 */
export async function updateUserStatus(id: bigint, status: 'active' | 'disabled'): Promise<void> {
  await prisma.user.update({ where: { id }, data: { status } });
}
