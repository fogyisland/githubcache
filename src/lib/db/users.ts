import type { User } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/**
 * List all users, newest first.
 *
 * No pagination — admin user list is small (per spec §9.1).
 */
export async function listUsers(): Promise<User[]> {
  return prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
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
