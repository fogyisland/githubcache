import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST as queryPOST } from '@/app/api/query/route';
import { POST as approvePOST } from '@/app/api/admin/dev-token-approve/[id]/route';
import { POST as revokePOST } from '@/app/api/admin/api-keys/[id]/revoke/route';
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
let testUserId = 0n;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  const user = await prisma.user.create({
    data: { email: 'flow@test', role: 'admin', status: 'active' },
  });
  testUserId = user.id;
});

afterAll(async () => {
  server.close();
  await prisma.requestLog.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.apiKey.deleteMany({ where: { userId: testUserId } });
  await prisma.user.deleteMany({ where: { email: 'flow@test' } });
  await prisma.repository.deleteMany({ where: { owner: { startsWith: TEST_OWNER_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  server.resetHandlers();
  await prisma.repository.deleteMany({ where: { owner: { startsWith: TEST_OWNER_PREFIX } } });
});

describe('API key lifecycle (dev-token mode)', () => {
  it('request -> approve -> use -> revoke -> 403', async () => {
    // Request a key
    const req = await requestKey({ userId: testUserId, name: 'flow-test-key-1' });
    expect(req.status).toBe('pending');

    // Approve via the admin endpoint
    const approveRes = await approvePOST(
      new Request(`http://x/api/admin/dev-token-approve/${req.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-dev-token': 'dev-only-token',
        },
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
        headers: { 'x-admin-dev-token': 'dev-only-token' },
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

  it('admin endpoints reject missing dev token with 404', async () => {
    const res = await approvePOST(
      new Request('http://x/api/admin/dev-token-approve/1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      { params: { id: '1' } },
    );
    expect(res.status).toBe(404);
  });

  it('admin endpoints reject wrong dev token with 404', async () => {
    const res = await revokePOST(
      new Request('http://x/api/admin/api-keys/1/revoke', {
        method: 'POST',
        headers: { 'x-admin-dev-token': 'wrong' },
      }),
      { params: { id: '1' } },
    );
    expect(res.status).toBe(404);
  });

  it('revokeKey on non-existent id throws', async () => {
    await expect(
      revokeKey({ id: BigInt(999999999), actorUserId: testUserId }),
    ).rejects.toThrow();
  });
});
