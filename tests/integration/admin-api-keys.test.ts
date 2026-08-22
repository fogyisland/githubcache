import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { PATCH as patchKey } from '@/app/api/admin/api-keys/[id]/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/api-keys/generate';

const TEST_EMAIL_PREFIX = 'admin-api-keys-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-api-keys-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';
const TEST_START = new Date();

let adminUserId: bigint;
let operatorUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';
let operatorSessionCookie = '';
const testKeyIds: bigint[] = [];

/**
 * Full CSRF + login round-trip; capture session + csrf cookies.
 * Mirrors the helper in admin-users.test.ts.
 */
async function login(email: string, password: string): Promise<{ sid: string; csrf: string }> {
  const csrfRes = await getCsrf();
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  const freshToken = csrfBody.csrfToken;
  const freshCsrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

  const loginRes = await postLogin(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: freshCsrfCookie,
        'x-csrf-token': freshToken,
      },
      body: JSON.stringify({ email, password, csrf: freshToken }),
    }),
  );
  expect(loginRes.status).toBe(200);

  const allCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionLine = allCookies.find((c) => c.startsWith('ghc_admin_sid='));
  const csrfLine = allCookies.find((c) => c.startsWith('ghc_csrf='));
  const sid = sessionLine?.split(';')[0] ?? '';
  let csrf = freshToken;
  if (csrfLine !== undefined) {
    csrf = csrfLine.split(';')[0] ?? csrf;
    csrf = csrf.slice('ghc_csrf='.length);
  }
  return { sid, csrf };
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

async function makeKey(): Promise<bigint> {
  const { hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      userId: adminUserId,
      name: `test-key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      keyPrefix: 'pending',
      keyHash: hash,
      status: 'active',
      rateLimitPerMin: 60,
      dailyQuota: 10000,
    },
  });
  testKeyIds.push(row.id);
  return row.id;
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

  // Login as admin
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;
  csrfToken = adminLogin.csrf;
  // After login, the rotated CSRF cookie lives in the login response Set-Cookie
  // header (not the GET /csrf response). For request building, the same value
  // is what we echo in the X-CSRF-Token header; pair with whatever cookie
  // we issued at the last Set-Cookie. Use the global csrfCookie to capture.
  // Simplest: re-issue and use that as the pair.
  const csrfRes = await getCsrf();
  csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  csrfToken = csrfBody.csrfToken;
}, 30_000);

afterAll(async () => {
  // Clean up: delete RequestLogs → ApiKeys → audit → sessions → users
  await prisma.requestLog.deleteMany({
    where: { apiKeyId: { in: testKeyIds } },
  });
  await prisma.apiKey.deleteMany({
    where: { id: { in: testKeyIds } },
  });
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: TEST_START } },
  });
  await prisma.session.deleteMany({
    where: { userId: { in: [adminUserId, operatorUserId] } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Ensure operator is active between tests (no session-revocation test here,
  // but be defensive)
  await prisma.user.update({
    where: { id: operatorUserId },
    data: { status: 'active' },
  });
  await prisma.session.deleteMany({ where: { userId: operatorUserId } });
});

describe('PATCH /api/admin/api-keys/[id]', () => {
  it('updates limits, returns 200, writes change_key_limits audit', async () => {
    const id = await makeKey();

    const res = await patchKey(
      new Request(`http://x/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          rateLimitPerMin: 200,
          dailyQuota: 50000,
          csrf: csrfToken,
        }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Verify DB
    const after = await prisma.apiKey.findUnique({ where: { id } });
    expect(after!.rateLimitPerMin).toBe(200);
    expect(after!.dailyQuota).toBe(50000);

    // Verify audit (>= 1, fire-and-forget race per M6.3 lesson)
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'change_key_limits', targetId: String(id) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    // Metadata must contain before/after
    const meta = audits[0]!.metadata as {
      before: { rateLimitPerMin: number; dailyQuota: number };
      after: { rateLimitPerMin: number; dailyQuota: number };
    };
    expect(meta.before).toEqual({ rateLimitPerMin: 60, dailyQuota: 10000 });
    expect(meta.after).toEqual({ rateLimitPerMin: 200, dailyQuota: 50000 });
  });

  it('returns 400 for an invalid body (rateLimitPerMin out of range)', async () => {
    const id = await makeKey();

    const res = await patchKey(
      new Request(`http://x/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          rateLimitPerMin: 99999, // exceeds max 10000
          dailyQuota: 50000,
          csrf: csrfToken,
        }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 when CSRF token does not match the cookie', async () => {
    const id = await makeKey();

    const res = await patchKey(
      new Request(`http://x/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          rateLimitPerMin: 200,
          dailyQuota: 50000,
          csrf: 'bogus-csrf-token-not-matching-cookie',
        }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(403);

    // Verify DB was NOT touched
    const after = await prisma.apiKey.findUnique({ where: { id } });
    expect(after!.rateLimitPerMin).toBe(60);
    expect(after!.dailyQuota).toBe(10000);
  });

  it('returns 403 when not authenticated', async () => {
    const id = await makeKey();

    const res = await patchKey(
      new Request(`http://x/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: csrfOnlyHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          rateLimitPerMin: 200,
          dailyQuota: 50000,
          csrf: csrfToken,
        }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent key id', async () => {
    const res = await patchKey(
      new Request('http://x/api/admin/api-keys/999999999999', {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          rateLimitPerMin: 200,
          dailyQuota: 50000,
          csrf: csrfToken,
        }),
      }),
      { params: { id: '999999999999' } },
    );
    expect(res.status).toBe(404);
  });

  it('allows an operator to change limits (per spec §9.1 — admin OR operator)', async () => {
    const id = await makeKey();
    const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    operatorSessionCookie = opLogin.sid;
    // Operator's CSRF — fetch a fresh token, then patch using those cookies.
    const csrfRes = await getCsrf();
    const opCsrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const opCsrfBody = (await csrfRes.json()) as { csrfToken: string };
    const opCsrfToken = opCsrfBody.csrfToken;

    const res = await patchKey(
      new Request(`http://x/api/admin/api-keys/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${opCsrfCookie}; ${operatorSessionCookie}`,
          'x-csrf-token': opCsrfToken,
        },
        body: JSON.stringify({
          rateLimitPerMin: 300,
          dailyQuota: 75000,
          csrf: opCsrfToken,
        }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);

    const after = await prisma.apiKey.findUnique({ where: { id } });
    expect(after!.rateLimitPerMin).toBe(300);
    expect(after!.dailyQuota).toBe(75000);

    // Audit actor must be the operator, not the admin
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'change_key_limits', targetId: String(id) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    // Most recent (operator) audit
    const sorted = audits.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    expect(sorted[0]!.actorUserId).toBe(operatorUserId);
  });
});