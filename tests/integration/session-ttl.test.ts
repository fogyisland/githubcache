import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { createSession, findSessionById } from '@/lib/db/sessions';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import {
  __resetAllLoginThrottlesForTests,
} from '@/lib/rate-limit/login-throttle';

const TEST_EMAIL_PREFIX = 'session-ttl-';
let testUserId: bigint;
let testUserEmail: string;
const TEST_PASSWORD = 'ttl-test-password';

beforeAll(async () => {
  testUserEmail = `${TEST_EMAIL_PREFIX}u-${Date.now()}@example.test`;
  const u = await prisma.user.create({
    data: {
      email: testUserEmail,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  testUserId = u.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: testUserId } });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: testUserId },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  __resetAllLoginThrottlesForTests();
  await prisma.session.deleteMany({ where: { userId: testUserId } });
});

describe('session TTL slide', () => {
  it('extends expiresAt when <4h remaining on findSessionById', async () => {
    const { id, expiresAt } = await createSession(testUserId);
    const originalExpiry = expiresAt.getTime();
    // Set session to expire in 3 hours (less than renewal threshold)
    const newExpiry = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await prisma.session.update({
      where: { id },
      data: { expiresAt: newExpiry },
    });
    // findSessionById should renew to ~8h from now
    const result = await findSessionById(id);
    expect(result).not.toBeNull();
    expect(result!.expiresAt.getTime()).toBeGreaterThan(originalExpiry - 1000);
    // Should now be ~8h from now (renewed)
    const minExpected = Date.now() + 7 * 60 * 60 * 1000;
    const maxExpected = Date.now() + 8 * 60 * 60 * 1000 + 1000;
    expect(result!.expiresAt.getTime()).toBeGreaterThanOrEqual(minExpected);
    expect(result!.expiresAt.getTime()).toBeLessThanOrEqual(maxExpected);
  });

  it('does NOT extend expiresAt when >4h remaining (avoids DB writes on most requests)', async () => {
    const { id } = await createSession(testUserId);
    // Set session to expire in 6 hours (above renewal threshold)
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) },
    });
    const beforeLookup = (await prisma.session.findUnique({ where: { id } }))!.expiresAt.getTime();
    const result = await findSessionById(id);
    expect(result).not.toBeNull();
    expect(result!.expiresAt.getTime()).toBe(beforeLookup);
    // Confirm we didn't write: read expiresAt from DB again — same as before
    const afterLookup = (await prisma.session.findUnique({ where: { id } }))!.expiresAt.getTime();
    expect(afterLookup).toBe(beforeLookup);
  });

  it('deletes expired session on findSessionById', async () => {
    const { id } = await createSession(testUserId);
    await prisma.session.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) }, // expired 1s ago
    });
    const result = await findSessionById(id);
    expect(result).toBeNull();
    // Row was cleaned up
    const row = await prisma.session.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it('full login flow: session expires after ~8h, slides on activity', async () => {
    // Login via the actual route
    const csrfRes = await getCsrf();
    const { csrfToken: initialCsrf } = (await csrfRes.json()) as { csrfToken: string };
    const initialCsrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const loginRes = await postLogin(
      new Request('http://x/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: initialCsrfCookie,
          'x-csrf-token': initialCsrf,
        },
        body: JSON.stringify({
          email: testUserEmail,
          password: TEST_PASSWORD,
          csrf: initialCsrf,
        }),
      }),
    );
    expect(loginRes.status).toBe(200);

    // Session row exists
    const sessions = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessions.length).toBe(1);
    const sessionId = sessions[0]!.id;
    const expiresAt = sessions[0]!.expiresAt.getTime();
    const ttlMs = expiresAt - Date.now();
    // TTL should be approximately 8 hours
    const expectedMs = 8 * 60 * 60 * 1000;
    expect(ttlMs).toBeGreaterThan(expectedMs - 60_000);
    expect(ttlMs).toBeLessThan(expectedMs + 60_000);

    // Simulate 4.5 hours passing (still >4h remaining) — no renewal
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + 4.5 * 60 * 60 * 1000) },
    });
    const beforeRenewal = (await prisma.session.findUnique({ where: { id: sessionId } }))!.expiresAt.getTime();
    await findSessionById(sessionId);
    const afterNoRenewal = (await prisma.session.findUnique({ where: { id: sessionId } }))!.expiresAt.getTime();
    expect(afterNoRenewal).toBe(beforeRenewal);

    // Simulate 3 hours remaining (below threshold) — renews to ~8h
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000) },
    });
    const renewed = await findSessionById(sessionId);
    expect(renewed).not.toBeNull();
    const renewedTtl = renewed!.expiresAt.getTime() - Date.now();
    expect(renewedTtl).toBeGreaterThan(7 * 60 * 60 * 1000);
  }, 30_000);
});
