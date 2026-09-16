import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { POST as restartPOST } from '@/app/api/admin/system/restart/route';
import { GET as csrfGET } from '@/app/api/admin/auth/csrf/route';
import { POST as loginPOST } from '@/app/api/admin/auth/login/route';

const TEST_EMAIL = 'restart-admin@example.test';
const TEST_PASSWORD = 'restart-test-password';

let adminCookie = '';
let adminCsrf = '';

beforeAll(async () => {
  // Seed an admin user for the test
  await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      role: 'admin',
      status: 0,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });

  // Log in once for CSRF + session cookies
  const csrfRes = await csrfGET();
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  adminCsrf = csrfToken;
  const csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const loginRes = await loginPOST(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        csrf: csrfToken,
      }),
    }),
  );
  expect(loginRes.status).toBe(200);

  const allCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionLine = allCookies.find((c) => c.startsWith('ghc_admin_sid='));
  const csrfLine = allCookies.find((c) => c.startsWith('ghc_csrf='));
  const sid = sessionLine?.split(';')[0] ?? '';
  let csrf = csrfToken;
  if (csrfLine !== undefined) {
    const c = csrfLine.split(';')[0] ?? '';
    csrf = c.slice('ghc_csrf='.length);
  }
  adminCookie = sid;
  adminCsrf = csrf;
});

afterAll(async () => {
  const adminId = await userIdFor(TEST_EMAIL).catch(() => null);
  if (adminId !== null) {
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: [adminId] } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [adminId] } },
    });
  }
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
});

function adminHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie: adminCookie,
    'x-csrf-token': adminCsrf,
  };
}

/** Lookup helper — needs the user row to exist already. */
async function userIdFor(email: string): Promise<bigint> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return u.id;
}

describe('POST /api/admin/system/restart', () => {
  it('rejects when confirm string is wrong', async () => {
    const res = await restartPOST(
      new Request('http://x/api/admin/system/restart', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ confirm: 'restart it' }), // wrong phrase
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-admin users with 403', async () => {
    // Create a non-admin user and log in as them
    const nonAdminEmail = 'restart-nonadmin@example.test';
    await prisma.user.create({
      data: {
        email: nonAdminEmail,
        role: 'operator',
        status: 0,
        passwordHash: await hashPassword('non-admin-pass'),
      },
    });

    // CSRF
    const csrfRes = await csrfGET();
    const { csrfToken: tCsrf } = (await csrfRes.json()) as { csrfToken: string };
    const tCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const loginRes = await loginPOST(
      new Request('http://x/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: tCookie,
          'x-csrf-token': tCsrf,
        },
        body: JSON.stringify({
          email: nonAdminEmail,
          password: 'non-admin-pass',
          csrf: tCsrf,
        }),
      }),
    );
    const allCookies = loginRes.headers.getSetCookie?.() ?? [];
    const sidLine = allCookies.find((c) => c.startsWith('ghc_admin_sid='));
    const sid = sidLine?.split(';')[0] ?? '';

    const res = await restartPOST(
      new Request('http://x/api/admin/system/restart', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: sid,
          'x-csrf-token': tCsrf,
        },
        body: JSON.stringify({ confirm: 'restart' }),
      }),
    );
    expect(res.status).toBe(403);

    // Cascade cleanup — sessions / audit rows reference this user
    const nonAdminId = await userIdFor(nonAdminEmail);
    await prisma.auditLog.deleteMany({
      where: { actorUserId: { in: [nonAdminId] } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [nonAdminId] } },
    });
    await prisma.user.deleteMany({ where: { email: nonAdminEmail } });
  });

  it('accepts the right confirm string + writes audit entry', async () => {
    // Inject a fake exit function so we don't actually send SIGTERM in tests
    const exitMock = vi.fn();
    (globalThis as { __GHC_RESTART_EXIT__?: () => void }).__GHC_RESTART_EXIT__ =
      exitMock;

    const res = await restartPOST(
      new Request('http://x/api/admin/system/restart', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ confirm: 'restart' }),
      }),
    );
    expect(res.status).toBe(200);

    // The audit row should exist
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'restart_server' },
      orderBy: { id: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.action).toBe('restart_server');
    expect(audit?.targetType).toBe('system');

    // Wait a tick for setImmediate to fire
    await new Promise((resolve) => setImmediate(resolve));
    expect(exitMock).toHaveBeenCalled();

    delete (globalThis as { __GHC_RESTART_EXIT__?: () => void }).__GHC_RESTART_EXIT__;
  });

  it('rejects when body is not JSON', async () => {
    const res = await restartPOST(
      new Request('http://x/api/admin/system/restart', {
        method: 'POST',
        headers: adminHeaders(),
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});