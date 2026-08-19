import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postApprove } from '@/app/api/admin/api-keys/[id]/approve/route';
import { POST as postRevoke } from '@/app/api/admin/api-keys/[id]/revoke/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/api-keys/generate';

const TEST_EMAIL_PREFIX = 'admin-routes-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-routes-password';

let adminUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

/**
 * Perform a full CSRF + login round-trip and capture the resulting cookies.
 *
 * Note: the login route rotates the CSRF token (OWASP), so the token issued by
 * GET /csrf is stale after login. We re-read `ghc_csrf` from the login
 * response's Set-Cookie headers via `getSetCookie()` (Next.js 14 / undici emit
 * multiple Set-Cookie lines, which `headers.get()` would flatten lossily).
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
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, csrf: csrfToken }),
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

async function makePendingKey(name: string): Promise<bigint> {
  const { hash: placeholderHash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      userId: adminUserId,
      name,
      keyPrefix: 'pending',
      keyHash: placeholderHash,
      status: 'pending',
    },
  });
  return row.id;
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  adminUserId = u.id;
  await loginAsAdmin();
}, 30_000);

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: adminUserId } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: adminUserId } });
  await prisma.auditLog.deleteMany({ where: { targetId: String(adminUserId) } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe('POST /api/admin/api-keys/[id]/approve (session-auth)', () => {
  it('returns 404 when no session', async () => {
    const id = await makePendingKey('test-approve-no-session');
    const res = await postApprove(
      new Request(`http://x/api/admin/api-keys/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(404);
    // The pending key must be untouched
    const row = await prisma.apiKey.findUnique({ where: { id } });
    expect(row?.status).toBe('pending');
  });

  it('approves a pending key with valid session + CSRF', async () => {
    const id = await makePendingKey('test-approve-ok');
    const res = await postApprove(
      new Request(`http://x/api/admin/api-keys/${id}/approve`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ rateLimit: 100, dailyQuota: 5000 }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      plain: string;
      keyPrefix: string;
    };
    expect(body.status).toBe('active');
    expect(body.plain).toMatch(/^ghc_live_[a-f0-9]{32}$/);
    expect(body.keyPrefix).toMatch(/^ghc_live_[a-f0-9]{3}$/);
    // Actor is the logged-in session user, not a "first admin" lookup
    const row = await prisma.apiKey.findUnique({ where: { id } });
    expect(row?.approvedBy).toBe(adminUserId);
    expect(row?.rateLimitPerMin).toBe(100);
    expect(row?.dailyQuota).toBe(5000);
  });

  it('returns 400 for invalid id', async () => {
    const res = await postApprove(
      new Request('http://x/api/admin/api-keys/not-a-number/approve', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({}),
      }),
      { params: { id: 'not-a-number' } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid id');
  });
});

describe('POST /api/admin/api-keys/[id]/revoke (session-auth)', () => {
  it('returns 404 when no session', async () => {
    const id = await makePendingKey('test-revoke-no-session');
    const res = await postRevoke(
      new Request(`http://x/api/admin/api-keys/${id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(404);
    const row = await prisma.apiKey.findUnique({ where: { id } });
    expect(row?.status).toBe('pending');
  });

  it('revokes an active key with valid session + CSRF', async () => {
    const id = await makePendingKey('test-revoke-ok');
    const approveRes = await postApprove(
      new Request(`http://x/api/admin/api-keys/${id}/approve`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({}),
      }),
      { params: { id: String(id) } },
    );
    expect(approveRes.status).toBe(200);

    const res = await postRevoke(
      new Request(`http://x/api/admin/api-keys/${id}/revoke`, {
        method: 'POST',
        headers: authHeaders(),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; revokedAt: string | null };
    expect(body.status).toBe('revoked');
    expect(body.revokedAt).not.toBeNull();
  });
});
