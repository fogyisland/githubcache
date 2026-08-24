import { hashPassword } from '@/lib/auth/password';
import { invalidateAllSessionsForUser } from '@/lib/db/sessions';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';

/**
 * Change a user's password and invalidate all their sessions.
 *
 * Per spec §8.5: "Sessions invalidated on password change". This enforces
 * that semantics at the data layer so any password-change UI (M7) gets
 * the right behavior for free.
 *
 * The user must re-login with the new password on any device.
 *
 * Side effects (in order):
 *   1. Update `users.password_hash` with bcrypt hash of new password
 *   2. Delete ALL `sessions` rows for the user (force-logout everywhere)
 *   3. Audit-log `password_changed` (targetType: user, targetId: user.id,
 *      actorUserId: actorUserId) — actor is the explicit `actorUserId`
 *      param (typically the admin performing the reset, NOT the target)
 *
 * Audit is fire-and-forget — the password change completes regardless of
 * audit success.
 */
export async function changePassword(
  userId: bigint,
  newPassword: string,
  actorUserId: bigint,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
  await invalidateAllSessionsForUser(userId);
  void writeAudit({
    action: 'password_changed',
    targetType: 'user',
    targetId: String(userId),
    actorUserId,
  });
}
