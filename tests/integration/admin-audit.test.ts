import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { GET as getAudit } from '@/app/api/admin/audit/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';

const TEST_EMAIL_PREFIX = 'admin-audit-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-audit-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';
const TEST_START = new Date();

let adminUserId: bigint;
let operatorUserId: bigint;
let sessionCookie = '';
let operatorSessionCookie = '';
const seededAuditIds: bigint[] = [];

async function login(email: string, password: string): Promise<{ sid: string }> {
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
  const sid = sessionLine?.split(';')[0] ?? '';
  return { sid };
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

  // Seed audit log rows with distinct actions/targets so we can filter
  // against them deterministically.
  const seeds = [
    {
      actorUserId: adminUserId,
      action: 'login_success',
      targetType: 'session',
      targetId: 'sess-1',
      metadata: { ip: '127.0.0.1' },
      ip: '127.0.0.1',
    },
    {
      actorUserId: adminUserId,
      action: 'change_key_limits',
      targetType: 'api_key',
      targetId: '42',
      metadata: { before: { a: 1 }, after: { a: 2 } },
      ip: '10.0.0.1',
    },
    {
      actorUserId: operatorUserId,
      action: 'register_token',
      targetType: 'github_token',
      targetId: 'gt-7',
      metadata: { label: 'github-tokens-test' },
      ip: '10.0.0.2',
    },
    {
      actorUserId: null,
      action: 'system_event',
      targetType: 'system',
      targetId: 'sys-1',
      metadata: null,
      ip: null,
    },
  ];
  for (const s of seeds) {
    const row = await prisma.auditLog.create({
      data: {
        actorUserId: s.actorUserId,
        action: s.action,
        targetType: s.targetType,
        targetId: s.targetId,
        ip: s.ip,
        ...(s.metadata !== null
          ? { metadata: s.metadata as Prisma.InputJsonValue }
          : { metadata: Prisma.JsonNull }),
      },
    });
    seededAuditIds.push(row.id);
  }

  // Login admin
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;

  // Login operator
  const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  operatorSessionCookie = opLogin.sid;
}, 30_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { id: { in: seededAuditIds } },
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

describe('GET /api/admin/audit', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await getAudit(new Request('http://x/api/admin/audit'));
    expect(res.status).toBe(403);
  });

  it('returns 403 when operator (not admin)', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit', {
        headers: { cookie: operatorSessionCookie },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 with admin session, no filters (ordered by createdAt desc)', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string; createdAt: string; action: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(typeof body.total).toBe('number');
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(Array.isArray(body.rows)).toBe(true);
    // Verify ordering: createdAt should be descending
    for (let i = 1; i < body.rows.length; i++) {
      const prev = new Date(body.rows[i - 1]!.createdAt).getTime();
      const cur = new Date(body.rows[i]!.createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it('filters by action', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?action=change_key_limits', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ action: string; actorEmail: string | null }>;
    };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of body.rows) {
      expect(r.action).toBe('change_key_limits');
    }
    // The seeded change_key_limits row was created by admin → actorEmail should match
    const target = body.rows.find((r) => r.action === 'change_key_limits');
    expect(target).toBeDefined();
    expect(target!.actorEmail).toBe(ADMIN_EMAIL);
  });

  it('filters by actorUserId', async () => {
    const res = await getAudit(
      new Request(
        `http://x/api/admin/audit?actorUserId=${operatorUserId.toString()}`,
        { headers: { cookie: sessionCookie } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ actorUserId: string }>;
    };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of body.rows) {
      expect(r.actorUserId).toBe(operatorUserId.toString());
    }
  });

  it('filters by targetType', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?targetType=api_key', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ targetType: string }>;
    };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of body.rows) {
      expect(r.targetType).toBe('api_key');
    }
  });

  it('filters by from/to date range', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await getAudit(
      new Request(
        `http://x/api/admin/audit?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`,
        { headers: { cookie: sessionCookie } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('paginates with limit + offset', async () => {
    // Seed 7 extra rows so the window reliably fills
    const ids: bigint[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await prisma.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'pagination_test',
          targetType: 'test',
          targetId: `pg-${i}`,
          metadata: { i },
          ip: '127.0.0.1',
        },
      });
      ids.push(r.id);
      seededAuditIds.push(r.id);
    }
    const res = await getAudit(
      new Request(
        'http://x/api/admin/audit?action=pagination_test&limit=3&offset=0',
        { headers: { cookie: sessionCookie } },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.limit).toBe(3);
    expect(body.offset).toBe(0);
    expect(body.total).toBe(7);
    expect(body.rows.length).toBe(3);

    const next = await getAudit(
      new Request(
        'http://x/api/admin/audit?action=pagination_test&limit=3&offset=3',
        { headers: { cookie: sessionCookie } },
      ),
    );
    expect(next.status).toBe(200);
    const nextBody = (await next.json()) as {
      rows: Array<{ id: string }>;
      offset: number;
    };
    expect(nextBody.offset).toBe(3);
    expect(nextBody.rows.length).toBe(3);
    // IDs must not overlap between pages
    const firstIds = new Set(body.rows.map((r) => r.id));
    for (const r of nextBody.rows) {
      expect(firstIds.has(r.id)).toBe(false);
    }
  });

  it('returns 400 for invalid limit', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?limit=999', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative offset', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?offset=-1', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer offset', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?offset=1.5', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid actorUserId', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?actorUserId=abc', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid from date', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit?from=not-a-date', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('BigInt ids serialized as strings', async () => {
    const res = await getAudit(
      new Request('http://x/api/admin/audit', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string; actorUserId: string | null }>;
    };
    for (const r of body.rows) {
      expect(typeof r.id).toBe('string');
      // actorUserId is string for non-null, null for null
      if (r.actorUserId !== null) {
        expect(typeof r.actorUserId).toBe('string');
      }
    }
  });
});
