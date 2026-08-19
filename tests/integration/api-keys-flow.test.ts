import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST as queryPOST } from '@/app/api/query/route';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as loginPOST } from '@/app/api/admin/auth/login/route';
import { POST as approvePOST } from '@/app/api/admin/api-keys/[id]/approve/route';
import { POST as revokePOST } from '@/app/api/admin/api-keys/[id]/revoke/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { requestKey, revokeKey } from '@/lib/api-keys/workflow';

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', ({ params }) =>
    HttpResponse.json({
      name: params.name,
      stargazers_count: 100,
      default_branch: 'main',
    }),
  ),
);

const TEST_OWNER_PREFIX = 'flow-test';
const TEST_EMAIL = 'flow@example.test';
const TEST_PASSWORD = 'flow-test-password';
let testUserId = 0n;
let adminCookie = '';
let adminCsrfToken = '';

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
  testUserId = user.id;

  // Log in once — the admin endpoints are session-authenticated (M6 replaced
  // the M3 dev-token header).
  const csrfRes = await getCsrf();
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const loginRes = await loginPOST(
    new Request('http://x/api/admin/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, csrf: csrfToken }),
    }),
  );
  expect(loginRes.status).toBe(200);
  const setCookies = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookies.find((c) => c.startsWith('ghc_admin_sid='))?.split(';')[0] ?? '';
  // CSRF is rotated on login — pick up the new value.
  const rotatedCsrf = setCookies.find((c) => c.startsWith('ghc_csrf='))?.split(';')[0] ?? csrfCookie;
  adminCsrfToken = rotatedCsrf.slice('ghc_csrf='.length);
  adminCookie = `${rotatedCsrf}; ${sessionCookie}`;
  expect(sessionCookie).not.toBe('');
}, 30_000);

afterAll(async () => {
  server.close();
  await prisma.requestLog.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.apiKey.deleteMany({ where: { userId: testUserId } });
  await prisma.session.deleteMany({ where: { userId: testUserId } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.repository.deleteMany({ where: { owner: { startsWith: TEST_OWNER_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  server.resetHandlers();
  await prisma.repository.deleteMany({ where: { owner: { startsWith: TEST_OWNER_PREFIX } } });
});

function adminHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie: adminCookie,
    'x-csrf-token': adminCsrfToken,
  };
}

describe('API key lifecycle (session-auth mode)', () => {
  it('request -> approve -> use -> revoke -> 403', async () => {
    // Request a key
    const req = await requestKey({ userId: testUserId, name: 'flow-test-key-1' });
    expect(req.status).toBe('pending');

    // Approve via the admin endpoint
    const approveRes = await approvePOST(
      new Request(`http://x/api/admin/api-keys/${req.id}/approve`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ rateLimit: 60, dailyQuota: 1000 }),
      }),
      { params: { id: String(req.id) } },
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as { plain: string; id: string };
    expect(approveBody.plain).toMatch(/^ghc_live_/);

    // Use the key on /api/query — node is new (first-miss), so 200 + fetch via MSW
    const queryRes = await queryPOST(
      new Request('http://x/api/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': approveBody.plain,
        },
        body: JSON.stringify({ nodes: ['flow-test/used'] }),
      }),
    );
    expect(queryRes.status).toBe(200);

    // Revoke via the admin endpoint
    const revokeRes = await revokePOST(
      new Request(`http://x/api/admin/api-keys/${req.id}/revoke`, {
        method: 'POST',
        headers: adminHeaders(),
      }),
      { params: { id: String(req.id) } },
    );
    expect(revokeRes.status).toBe(200);

    // After revocation, the key should be rejected
    const afterRes = await queryPOST(
      new Request('http://x/api/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': approveBody.plain,
        },
        body: JSON.stringify({ nodes: ['flow-test/used'] }),
      }),
    );
    expect(afterRes.status).toBe(403);
  });

  it('approve rejects missing session with 404', async () => {
    const res = await approvePOST(
      new Request('http://x/api/admin/api-keys/1/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      { params: { id: '1' } },
    );
    expect(res.status).toBe(404);
  });

  it('revoke rejects a forged session cookie with 404', async () => {
    const res = await revokePOST(
      new Request('http://x/api/admin/api-keys/1/revoke', {
        method: 'POST',
        headers: { cookie: 'ghc_admin_sid=not-a-real-session-id' },
      }),
      { params: { id: '1' } },
    );
    expect(res.status).toBe(404);
  });

  it('revokeKey on non-existent id throws', async () => {
    await expect(revokeKey({ id: BigInt(999999999), actorUserId: testUserId })).rejects.toThrow();
  });
});
