import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createSession as dbCreateSession,
  findSessionById,
  invalidateSession,
  invalidateAllSessionsForUser,
  generateSessionId,
  SESSION_TTL_HOURS,
} from '@/lib/db/sessions';
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromCookie,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { env } from '@/lib/config/env';

const TEST_EMAIL_PREFIX = 'session-test-';
let testUserId: bigint;
let testUserId2: bigint;

beforeAll(async () => {
  const u1 = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}u1-${Date.now()}@test`,
      role: 'admin',
      status: 'active',
    },
  });
  const u2 = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}u2-${Date.now()}@test`,
      role: 'admin',
      status: 'active',
    },
  });
  testUserId = u1.id;
  testUserId2 = u2.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
});

describe('generateSessionId', () => {
  it('returns 43-char base64url string', () => {
    const id = generateSessionId();
    expect(id).toHaveLength(43);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe('dbCreateSession', () => {
  it('creates a session row with expiresAt ~8h in the future', async () => {
    const before = Date.now();
    const { id, expiresAt, session } = await dbCreateSession(testUserId, '127.0.0.1');
    expect(session.userId).toBe(testUserId);
    expect(session.ip).toBe('127.0.0.1');
    expect(id).toHaveLength(43);
    const expectedMin = before + SESSION_TTL_HOURS * 60 * 60 * 1000 - 1000;
    const expectedMax = before + SESSION_TTL_HOURS * 60 * 60 * 1000 + 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});

describe('findSessionById', () => {
  it('returns null for missing id', async () => {
    const result = await findSessionById('does-not-exist');
    expect(result).toBeNull();
  });

  it('returns session + user for valid id', async () => {
    const { id } = await dbCreateSession(testUserId, '127.0.0.1');
    const result = await findSessionById(id);
    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(testUserId);
  });

  it('returns null and deletes for expired session', async () => {
    const { id } = await dbCreateSession(testUserId);
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await findSessionById(id);
    expect(result).toBeNull();
    const row = await prisma.session.findUnique({ where: { id } });
    expect(row).toBeNull(); // expired row was cleaned up
  });

  it('returns null and deletes session for disabled user', async () => {
    const { id } = await dbCreateSession(testUserId);
    await prisma.user.update({ where: { id: testUserId }, data: { status: 'disabled' } });
    const result = await findSessionById(id);
    expect(result).toBeNull();
    const row = await prisma.session.findUnique({ where: { id } });
    expect(row).toBeNull();
    // Restore for cleanup
    await prisma.user.update({ where: { id: testUserId }, data: { status: 'active' } });
  });

  it('renews expiresAt if <4h remaining (sliding renewal)', async () => {
    const { id } = await dbCreateSession(testUserId);
    // Set to expire in 3 hours (less than renewal threshold)
    const soonExpiry = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await prisma.session.update({ where: { id }, data: { expiresAt: soonExpiry } });
    const result = await findSessionById(id);
    expect(result).not.toBeNull();
    // Should now be ~8h from now (renewed)
    const renewedMs = result!.expiresAt.getTime();
    const minExpected = Date.now() + 7 * 60 * 60 * 1000;
    const maxExpected = Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000 + 1000;
    expect(renewedMs).toBeGreaterThanOrEqual(minExpected);
    expect(renewedMs).toBeLessThanOrEqual(maxExpected);
  });

  it('does not renew if >4h remaining (avoids writes on most requests)', async () => {
    const { id } = await dbCreateSession(testUserId);
    const originalExpiry = (await prisma.session.findUnique({ where: { id } }))!.expiresAt;
    const result = await findSessionById(id);
    expect(result?.expiresAt.getTime()).toBe(originalExpiry.getTime());
  });
});

describe('invalidateSession / invalidateAllSessionsForUser', () => {
  it('deletes a single session', async () => {
    const { id } = await dbCreateSession(testUserId);
    await invalidateSession(id);
    const row = await prisma.session.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it('deleteAll returns count and removes rows for that user only', async () => {
    await dbCreateSession(testUserId);
    await dbCreateSession(testUserId);
    await dbCreateSession(testUserId2);
    const count = await invalidateAllSessionsForUser(testUserId);
    expect(count).toBe(2);
    const remaining = await prisma.session.count({ where: { userId: testUserId } });
    expect(remaining).toBe(0);
    const otherUser = await prisma.session.count({ where: { userId: testUserId2 } });
    expect(otherUser).toBe(1);
  });
});

describe('cookie helpers', () => {
  it('setSessionCookie writes correct Set-Cookie header', () => {
    const res = { headers: new Headers() };
    const exp = new Date(Date.now() + 8 * 60 * 60 * 1000);
    setSessionCookie(res, 'abc123', exp);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).not.toBeNull();
    expect(cookie!).toContain('ghc_admin_sid=abc123');
    expect(cookie!).toContain('Path=/');
    expect(cookie!).toContain('HttpOnly');
    expect(cookie!).toContain('SameSite=Lax');
    expect(cookie!).toContain('Expires=');
    if (env.NODE_ENV === 'production') {
      expect(cookie!).toContain('Secure');
    } else {
      expect(cookie!).not.toContain('Secure');
    }
  });

  it('clearSessionCookie sets Max-Age=0', () => {
    const res = { headers: new Headers() };
    clearSessionCookie(res);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).not.toBeNull();
    expect(cookie!).toContain('ghc_admin_sid=');
    expect(cookie!).toContain('Max-Age=0');
    expect(cookie!).toContain('HttpOnly');
  });

  it('getSessionIdFromCookie reads via req.cookies (Next.js convention)', () => {
    const req = {
      headers: new Headers(),
      cookies: {
        get: (name: string) =>
          name === 'ghc_admin_sid' ? { value: 'from-cookies-api' } : undefined,
      },
    };
    expect(getSessionIdFromCookie(req)).toBe('from-cookies-api');
  });

  it('getSessionIdFromCookie falls back to Cookie header parsing', () => {
    const req = {
      headers: new Headers({ cookie: 'other=foo; ghc_admin_sid=from-header; bar=baz' }),
    };
    expect(getSessionIdFromCookie(req)).toBe('from-header');
  });

  it('getSessionIdFromCookie returns null when no cookie', () => {
    const req = { headers: new Headers() };
    expect(getSessionIdFromCookie(req)).toBeNull();
  });
});
