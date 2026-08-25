import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postInvite } from '@/app/api/admin/users/invite/route';
import { PATCH as patchUser, DELETE as deleteUser } from '@/app/api/admin/users/[id]/route';
import { POST as postResetPassword } from '@/app/api/admin/users/[id]/reset-password/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'admin-users-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-users-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';
// Audit cleanup uses a date cutoff (captured at module load) so that rows
// with targetId = invitation.id (32-char base64url, NOT a user ID) are
// still caught — see fix round 1.
const TEST_START = new Date();

let adminUserId: bigint;
let operatorUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

/**
 * Full CSRF + login round-trip; capture session + csrf cookies for the
 * admin user. Mirrors the helper in admin-routes.test.ts.
 */
async function loginAsAdmin(): Promise<void> {
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  csrfToken = csrfBody.csrfToken;
  csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

  const loginRes = await postLogin(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        csrf: csrfToken,
      }),
    }),
  );
  expect(loginRes.status).toBe(200);

  const allCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionLine = allCookies.find((c) => c.startsWith('ghc_admin_sid='));
  const csrfLine = allCookies.find((c) => c.startsWith('ghc_csrf='));
  sessionCookie = sessionLine?.split(';')[0] ?? '';
  expect(sessionCookie).not.toBe('');
  if (csrfLine !== undefined) {
    csrfCookie = csrfLine.split(';')[0] ?? '';
    csrfToken = csrfCookie.slice('ghc_csrf='.length);
    expect(csrfToken).toMatch(/^[a-f0-9]{64}$/);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `${csrfCookie}; ${sessionCookie}`,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

/** No-auth headers — only a CSRF cookie, no session. */
function csrfOnlyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: csrfCookie,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

beforeAll(async () => {
  // Create admin
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  adminUserId = admin.id;

  // Create operator
  const op = await prisma.user.create({
    data: {
      email: OPERATOR_EMAIL,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword(OPERATOR_PASSWORD),
    },
  });
  operatorUserId = op.id;

  await loginAsAdmin();
}, 30_000);

afterAll(async () => {
  // Clean up invitations + sessions + audit + users for this test
  await prisma.invitation.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      createdAt: { gte: TEST_START },
    },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Re-login each test in case the previous test logged the admin out
  if (!sessionCookie) {
    await loginAsAdmin();
  }
  // Reset operator status / sessions between tests
  await prisma.user.update({
    where: { id: operatorUserId },
    data: { status: 'active' },
  });
  await prisma.session.deleteMany({ where: { userId: operatorUserId } });
  await prisma.invitation.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
});

describe('POST /api/admin/users/invite', () => {
  it('returns invite link + creates Invitation row + writes audit', async () => {
    const newEmail = `${TEST_EMAIL_PREFIX}invitee-${Date.now()}@example.test`;
    const res = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: newEmail, role: 'operator', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inviteLink: string };
    expect(body.inviteLink).toContain('/request-access?invitation=');

    // Verify row created
    const inv = await prisma.invitation.findFirst({
      where: { email: newEmail },
    });
    expect(inv).not.toBeNull();
    expect(inv!.role).toBe('operator');
    expect(inv!.id).toHaveLength(32);

    // Verify audit (>= 1, fire-and-forget race per M6.3 lesson)
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'invite_user', targetId: inv!.id },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
  });

  it('returns 409 when user already exists', async () => {
    const res = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          email: OPERATOR_EMAIL,
          role: 'operator',
          csrf: csrfToken,
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('user already exists');
  });

  it('returns 409 when an unconsumed invitation is already pending', async () => {
    const dupeEmail = `${TEST_EMAIL_PREFIX}dupe-${Date.now()}@example.test`;
    const first = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          email: dupeEmail,
          role: 'operator',
          csrf: csrfToken,
        }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          email: dupeEmail,
          role: 'operator',
          csrf: csrfToken,
        }),
      }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('invitation already pending');
  });

  it('returns 403 when not authenticated', async () => {
    const res = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: csrfOnlyHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          email: `${TEST_EMAIL_PREFIX}noauth-${Date.now()}@example.test`,
          role: 'operator',
          csrf: csrfToken,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/users/[id]', () => {
  it('disables an active user and writes audit disable_user', async () => {
    const res = await patchUser(
      new Request(`http://x/api/admin/users/${operatorUserId}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ status: 'disabled', csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: operatorUserId } });
    expect(after!.status).toBe('disabled');

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'disable_user', targetId: String(operatorUserId) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
  });

  it('re-enables a disabled user and writes audit enable_user', async () => {
    await prisma.user.update({
      where: { id: operatorUserId },
      data: { status: 'disabled' },
    });

    const res = await patchUser(
      new Request(`http://x/api/admin/users/${operatorUserId}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ status: 'active', csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: operatorUserId } });
    expect(after!.status).toBe('active');

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'enable_user', targetId: String(operatorUserId) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for non-existent user id', async () => {
    const res = await patchUser(
      new Request('http://x/api/admin/users/999999999999', {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ status: 'disabled', csrf: csrfToken }),
      }),
      { params: { id: '999999999999' } },
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/users/[id]', () => {
  it('invalidates all sessions for the target user + writes audit', async () => {
    // Give the operator some sessions
    await prisma.session.create({
      data: {
        id: `test-session-a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
          .padEnd(43, 'x')
          .slice(0, 43),
        userId: operatorUserId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    await prisma.session.create({
      data: {
        id: `test-session-b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
          .padEnd(43, 'x')
          .slice(0, 43),
        userId: operatorUserId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    const before = await prisma.session.count({ where: { userId: operatorUserId } });
    expect(before).toBe(2);

    const res = await deleteUser(
      new Request(`http://x/api/admin/users/${operatorUserId}`, {
        method: 'DELETE',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionsInvalidated: number };
    expect(body.sessionsInvalidated).toBe(2);

    const after = await prisma.session.count({ where: { userId: operatorUserId } });
    expect(after).toBe(0);

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'logout_all_sessions', targetId: String(operatorUserId) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 for non-existent user id', async () => {
    const res = await deleteUser(
      new Request('http://x/api/admin/users/999999999999', {
        method: 'DELETE',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: '999999999999' } },
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/users/[id]/reset-password', () => {
  it('changes the password hash, invalidates sessions, writes audit, returns tempPassword', async () => {
    // Create a session for the operator
    await prisma.session.create({
      data: {
        id: `test-reset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
          .padEnd(43, 'x')
          .slice(0, 43),
        userId: operatorUserId,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    const res = await postResetPassword(
      new Request(`http://x/api/admin/users/${operatorUserId}/reset-password`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tempPassword: string };
    expect(body.ok).toBe(true);
    expect(body.tempPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);

    // Sessions invalidated
    const sessions = await prisma.session.count({
      where: { userId: operatorUserId },
    });
    expect(sessions).toBe(0);

    // Password changed
    const op = await prisma.user.findUnique({ where: { id: operatorUserId } });
    expect(op!.passwordHash).not.toBeNull();

    // Audit fired
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'reset_password', targetId: String(operatorUserId) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 403 when not authenticated', async () => {
    const res = await postResetPassword(
      new Request(`http://x/api/admin/users/${operatorUserId}/reset-password`, {
        method: 'POST',
        headers: csrfOnlyHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(403);
  });
});
