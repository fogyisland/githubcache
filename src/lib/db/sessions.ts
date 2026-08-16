import { randomBytes } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export const SESSION_TTL_HOURS = 8;
export const SESSION_RENEWAL_THRESHOLD_HOURS = 4; // renew if <4h remaining

/**
 * Generate a session ID: 32 random bytes encoded as base64url (43 chars).
 * Matches `sessions.id CHAR(43)` schema.
 */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Create a new session row for the given user. Returns the session ID,
 * expiration time, and the created row so callers can set the cookie.
 *
 * `ip` is stored verbatim for audit purposes only (not used for auth).
 */
export async function createSession(
  userId: bigint,
  ip?: string,
): Promise<{ id: string; expiresAt: Date; session: Session }> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt,
      ...(ip !== undefined ? { ip } : {}),
    },
  });
  return { id, expiresAt, session };
}

/**
 * Look up a session by ID. Returns the session row (with user joined) or null
 * if expired / missing / user disabled.
 *
 * On lookup success, implements sliding renewal: if <4h remaining, extends
 * expiresAt by 8h. This avoids writing on every request (most requests hit
 * the "plenty of time left" branch).
 *
 * Also deletes the session row on find when:
 *   - The session is expired
 *   - The user is disabled (status != 'active')
 * The delete-on-find ensures disabled users can't continue browsing even if
 * their session cookie is still alive.
 */
export async function findSessionById(id: string): Promise<(Session & { user: User }) | null> {
  const row = await prisma.session.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    // Expired — delete and return null
    await prisma.session.delete({ where: { id } }).catch(() => {
      /* ignore race */
    });
    return null;
  }
  if (row.user.status !== 'active') {
    // User disabled — delete session and return null
    await prisma.session.delete({ where: { id } }).catch(() => {
      /* ignore race */
    });
    return null;
  }
  // Sliding renewal: if < threshold remaining, extend
  const remainingMs = row.expiresAt.getTime() - Date.now();
  const thresholdMs = SESSION_RENEWAL_THRESHOLD_HOURS * 60 * 60 * 1000;
  if (remainingMs < thresholdMs) {
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    await prisma.session.update({
      where: { id },
      data: { expiresAt: newExpiresAt },
    });
    row.expiresAt = newExpiresAt;
  }
  return row;
}

/**
 * Delete a single session (logout).
 */
export async function invalidateSession(id: string): Promise<void> {
  await prisma.session.delete({ where: { id } }).catch(() => {
    /* already gone */
  });
}

/**
 * Delete ALL sessions for a user (logout-everywhere + password-change).
 * Returns the number of rows deleted.
 */
export async function invalidateAllSessionsForUser(userId: bigint): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}
