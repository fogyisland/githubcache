import { prisma } from '@/lib/db/client';

/**
 * Setup status — the source of truth for "has the operator finished
 * running /init?" (M32.6 / M32.6.1).
 *
 * Signal is DB-derived, not cookie-derived: "setup is done iff there is
 * at least one user with `role='admin'` in the users table." That
 * matches what the wizard creates in step 3, and is independent of any
 * browser-side state.
 *
 * M32.6.1 — empty-DB probe via `information_schema`. On a brand-new
 * deploy the DB exists but the `users` table doesn't. Calling
 * `prisma.user.count(...)` here would raise P2021 and 500 the wizard
 * before the operator can reach step 1 to create the table. Instead we
 * check `INFORMATION_SCHEMA.TABLES` first — that query is metadata,
 * never throws on missing user tables, and works even when no app
 * tables exist at all. Only when the `users` table is confirmed present
 * do we count rows.
 *
 * This module runs in Node.js (called from a Node-runtime API route and
 * from a Node-runtime server component). The Edge middleware fetches
 * the API route instead of importing this file directly, because
 * middleware can only use Edge-compatible APIs and Prisma is not
 * Edge-compatible.
 */
export interface SetupStatus {
  done: boolean;
  reason:
    | 'admin_present'
    | 'no_admin_user'
    | 'users_table_missing'
    | 'database_unreachable';
}

/**
 * Returns true iff the `users` table exists in the current database.
 * Uses INFORMATION_SCHEMA which is metadata — never throws when the
 * database is reachable but the app tables are absent.
 */
async function usersTableExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*) AS count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
  `;
  const count = Number(rows[0]?.count ?? 0);
  return count > 0;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  if (!(await usersTableExists())) {
    return { done: false, reason: 'users_table_missing' };
  }
  const adminCount = await prisma.user.count({
    where: { role: 'admin' },
  });
  if (adminCount > 0) {
    return { done: true, reason: 'admin_present' };
  }
  return { done: false, reason: 'no_admin_user' };
}
