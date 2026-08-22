import { randomBytes } from 'node:crypto';
import type { Invitation } from '@prisma/client';
import { prisma } from '@/lib/db/client';

const INVITATION_TTL_HOURS_DEFAULT = 168; // 7 days

/**
 * Generate a 32-character base64url invitation ID.
 *
 * 24 random bytes → 32 base64url chars (no padding), matching the
 * `invitations.id CHAR(32)` column width.
 */
function generateInvitationId(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Create a new pending invitation. Caller is responsible for uniqueness
 * checks (existing user with this email, or pending unconsumed invite)
 * — see POST /api/admin/users/invite.
 */
export async function createInvitation(
  email: string,
  role: 'admin' | 'operator',
  invitedBy: bigint,
  ttlHours: number = INVITATION_TTL_HOURS_DEFAULT,
): Promise<Invitation> {
  return prisma.invitation.create({
    data: {
      id: generateInvitationId(),
      email,
      role,
      invitedBy,
      expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000),
    },
  });
}

/**
 * Look up an invitation by its ID.
 */
export async function findInvitationById(id: string): Promise<Invitation | null> {
  return prisma.invitation.findUnique({ where: { id } });
}

/**
 * Mark an invitation as consumed, but only if it is still pending AND not
 * expired. Returns the updated invitation row, or null if no transition
 * happened (already consumed or expired).
 *
 * Uses `updateMany` so the consume transition is atomic at the SQL level
 * — concurrent callers cannot both succeed.
 */
export async function consumeInvitation(id: string): Promise<Invitation | null> {
  const result = await prisma.invitation.updateMany({
    where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (result.count === 0) return null;
  return prisma.invitation.findUnique({ where: { id } });
}

/**
 * List all invitations, newest first. Used by the admin users page.
 */
export async function listInvitations(): Promise<Invitation[]> {
  return prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } });
}
