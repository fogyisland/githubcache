/**
 * M31.x.b — verifies the `users_status_audit` BEFORE UPDATE trigger
 * writes a `user_status_changed_shadow` row to `audit_log` for any UPDATE
 * that changes `users.user_status`, regardless of how the UPDATE is issued.
 *
 * Three contract checks:
 * 1. Direct SQL UPDATE (no application code path) — produces a shadow row
 *    with actor_user_id=0 (the trigger's default for out-of-band writes).
 * 2. Application path via `updateUserStatus()` (sets @app_source =
 *    'application') — produces only the in-app `disable_user`/`enable_user`
 *    row, NOT a duplicate shadow row.
 * 3. UPDATE that does not touch `user_status` — produces zero rows of
 *    any kind for the user (the trigger only fires on status change).
 *
 * The trigger is installed out-of-band by `scripts/install-status-trigger.mjs`
 * (Prisma migrate deploy cannot parse BEGIN ... END trigger bodies — see
 * migration 20260913000005_user_status_audit_trigger/migration.sql for the
 * rationale). If the trigger is missing this file's first test will fail
 * with the trigger-missing symptom: no audit row written.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { updateUserStatus, UserStatus } from '@/lib/db/users';

const TEST_EMAIL_PREFIX = 'admin-users-shadow-';
const testUserIds: bigint[] = [];
let adminUserId: bigint;

async function ensureTrigger(): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ TRIGGER_NAME: string }>
  >`
    SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'users_status_audit'
  `;
  if (rows.length === 0) {
    throw new Error(
      'users_status_audit trigger is missing — run `node scripts/install-status-trigger.mjs` first',
    );
  }
}

beforeAll(async () => {
  await ensureTrigger();
  // One long-lived admin to act as the in-app actor for case (2).
  const admin = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`,
      role: 'admin',
    },
  });
  adminUserId = admin.id;
  // Two target users — one for direct SQL, one for app-layer path. The
  // third case (no status change) reuses the direct-SQL target before it
  // gets flipped, so no separate fixture is needed.
  for (let i = 0; i < 2; i++) {
    const u = await prisma.user.create({
      data: {
        email: `${TEST_EMAIL_PREFIX}target-${i}-${Date.now()}@example.test`,
        role: 'operator',
      },
    });
    testUserIds.push(u.id);
  }
});

afterAll(async () => {
  // Clean audit rows first (so we don't orphan audit_log entries pointing
  // at deleted user IDs), then delete the users themselves.
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [adminUserId, ...testUserIds] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [adminUserId, ...testUserIds] } },
  });
  await prisma.$disconnect();
});

describe('users_status_audit trigger (M31.x.b)', () => {
  it('writes user_status_changed_shadow audit row on direct SQL UPDATE', async () => {
    const targetId = testUserIds[0]!;
    const before = await prisma.auditLog.count({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });

    // Issue the UPDATE through raw SQL — bypasses updateUserStatus(), so
    // @app_source is empty and @app_actor is null. The trigger should
    // see the status change and write a shadow row with actor_user_id=0.
    await prisma.$executeRawUnsafe(
      `UPDATE users SET user_status = ${UserStatus.Disabled} WHERE id = ${targetId}`,
    );
    // BEFORE UPDATE trigger fires synchronously, but INSERT into audit_log
    // is its own statement — give the server a beat to flush.
    await new Promise((r) => setTimeout(r, 100));

    const shadows = await prisma.auditLog.findMany({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });
    expect(shadows.length).toBeGreaterThan(before);
    const latest = shadows[shadows.length - 1]!;
    expect(latest.actorUserId).toBe(0n);
    expect(latest.targetType).toBe('user');
    expect(latest.metadata).toMatchObject({
      previousStatus: UserStatus.Active,
      newStatus: UserStatus.Disabled,
      source: 'db_trigger',
    });

    // Restore so the next test starts from active.
    await prisma.user.update({
      where: { id: targetId },
      data: { status: UserStatus.Active },
    });
  });

  it('does NOT write shadow row when app layer sets @app_source=application', async () => {
    const targetId = testUserIds[1]!;
    const before = await prisma.auditLog.count({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });

    // updateUserStatus() is the DB-layer helper called by PATCH
    // /api/admin/users/[id]. It sets @app_source = 'application' inside
    // its transaction, which the trigger checks first and returns on.
    // The in-app audit row (`disable_user` / `enable_user`) is written
    // separately by the route handler via writeAudit() — that's tested
    // in tests/integration/admin-users.test.ts:240,262. This test only
    // asserts the trigger's @app_source suppression.
    await updateUserStatus(targetId, UserStatus.Disabled, adminUserId);
    await new Promise((r) => setTimeout(r, 100));

    const after = await prisma.auditLog.count({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });
    expect(after).toBe(before);

    // Restore so case (3) and future test runs start from active.
    await updateUserStatus(targetId, UserStatus.Active, adminUserId);
  });

  it('does NOT write shadow row when UPDATE does not touch user_status', async () => {
    const targetId = testUserIds[0]!;
    const before = await prisma.auditLog.count({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });

    await prisma.user.update({
      where: { id: targetId },
      data: { theme: 'terminal' }, // unrelated column
    });
    await new Promise((r) => setTimeout(r, 100));

    const after = await prisma.auditLog.count({
      where: { action: 'user_status_changed_shadow', targetId: String(targetId) },
    });
    expect(after).toBe(before);
  });
});