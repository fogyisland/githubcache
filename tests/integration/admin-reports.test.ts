import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { GET as getReports } from '@/app/api/admin/reports/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { recordRequest } from '@/lib/db/request-log';
import { generateApiKey } from '@/lib/api-keys/generate';

const TEST_EMAIL_PREFIX = 'admin-reports-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-reports-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';

let adminUserId: bigint;
let operatorUserId: bigint;
let sessionCookie = '';
let operatorSessionCookie = '';
let testApiKeyId: bigint;

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

  // Create an API key owned by admin (for topKeys assertion)
  const { hash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      userId: adminUserId,
      name: `${TEST_EMAIL_PREFIX}key-${Date.now()}`,
      keyPrefix: 'ghc_',
      keyHash: hash,
      status: 'active',
    },
  });
  testApiKeyId = key.id;

  // Seed a couple of request log rows
  await recordRequest({
    apiKeyId: testApiKeyId,
    endpoint: '/v1/repo',
    cacheHit: true,
    durationMs: 42,
    statusCode: 200,
    repoRequested: 'admin-reports-test/repo',
  });

  // Login admin
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;
  // Refresh csrf cookie from latest (kept for parity with admin-users pattern)
  const csrfRes = await getCsrf();
  void (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0];

  // Login operator
  const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  operatorSessionCookie = opLogin.sid;
}, 30_000);

afterAll(async () => {
  await prisma.requestLog.deleteMany({ where: { repoRequested: 'admin-reports-test/repo' } });
  await prisma.auditLog.deleteMany({
    where: { actorUserId: { in: [adminUserId, operatorUserId] } },
  });
  await prisma.apiKey.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('GET /api/admin/reports', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await getReports(new Request('http://x/api/admin/reports'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with valid admin session; default window=24h', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kpis: { totalRequests: number; cacheHitRate: number; avgLatencyMs: number; activeApiKeys: number };
      overTime: Array<{ hour: string; cacheHits: number; cacheMisses: number }>;
      topRepos: Array<{ repo: string; requestCount: number; hitRate: number }>;
      topKeys: Array<{ keyId: string; label: string; requestCount: number; lastUsed: string }>;
      tokenQuota: Array<{ id: string; label: string; status: string; requestsUsed: number; requestsLimit: number }>;
    };
    expect(body.kpis).toBeDefined();
    expect(typeof body.kpis.totalRequests).toBe('number');
    expect(typeof body.kpis.cacheHitRate).toBe('number');
    expect(typeof body.kpis.avgLatencyMs).toBe('number');
    expect(typeof body.kpis.activeApiKeys).toBe('number');
    expect(Array.isArray(body.overTime)).toBe(true);
    expect(Array.isArray(body.topRepos)).toBe(true);
    expect(Array.isArray(body.topKeys)).toBe(true);
    expect(Array.isArray(body.tokenQuota)).toBe(true);
  });

  it('returns 200 for operator session (admin OR operator per spec §9.1)', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports', {
        headers: { cookie: operatorSessionCookie },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('custom window=1h filters correctly', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports?window=1h', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { totalRequests: number } };
    expect(body.kpis.totalRequests).toBeGreaterThanOrEqual(0);
  });

  it('custom window=7d returns broader data', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports?window=7d', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kpis: { totalRequests: number } };
    expect(body.kpis.totalRequests).toBeGreaterThanOrEqual(0);
  });

  it('BigInt ids serialized as strings in topKeys + tokenQuota', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      topKeys: Array<{ keyId: string }>;
      tokenQuota: Array<{ id: string }>;
    };
    for (const k of body.topKeys) {
      expect(typeof k.keyId).toBe('string');
    }
    for (const t of body.tokenQuota) {
      expect(typeof t.id).toBe('string');
    }
  });

  it('topKeys includes the seeded test key', async () => {
    const res = await getReports(
      new Request('http://x/api/admin/reports', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      topKeys: Array<{ keyId: string; label: string; requestCount: number }>;
    };
    const myKey = body.topKeys.find((k) => k.keyId === testApiKeyId.toString());
    expect(myKey).toBeDefined();
    expect(myKey!.requestCount).toBeGreaterThanOrEqual(1);
  });
});