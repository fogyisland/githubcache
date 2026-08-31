import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postTick } from '@/app/api/admin/queue/tick/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { pause, resume } from '@/lib/scheduler/state';

const TEST_EMAIL_PREFIX = 'admin-queue-tick-';
const REPO_OWNER_PREFIX = 'admin-queue-tick-repo-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-queue-tick-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';
const TEST_START = new Date();

let adminUserId: bigint;
let operatorUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';
let operatorSessionCookie = '';

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

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `${csrfCookie}; ${sessionCookie}`,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

function operatorHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `${csrfCookie}; ${operatorSessionCookie}`,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

vi.mock('@/lib/github/pool', () => ({
  initPool: vi.fn(() => Promise.resolve()),
  // null → refreshOne fails fast and the job stays pending.
  pickToken: vi.fn(() => null),
  recordUsage: vi.fn(() => Promise.resolve()),
  getBackoff: vi.fn(() => 10),
  shutdownPool: vi.fn(() => Promise.resolve()),
  poolSize: vi.fn(() => 0),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
    },
  });
  adminUserId = admin.id;

  const op = await prisma.user.create({
    data: {
      email: OPERATOR_EMAIL,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword(OPERATOR_PASSWORD),
    },
  });
  operatorUserId = op.id;

  const a = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = a.sid;
  csrfCookie = `ghc_csrf=${a.csrf}`;
  csrfToken = a.csrf;

  const o = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  operatorSessionCookie = o.sid;
}, 30_000);

afterAll(async () => {
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: REPO_OWNER_PREFIX } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { action: 'manual_scheduler_tick' },
        { actorUserId: { in: [adminUserId, operatorUserId] } },
      ],
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
  resume();
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: REPO_OWNER_PREFIX } },
  });
});

describe('POST /api/admin/queue/tick — auth & role gating', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csrf: 'whatever' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when operator (not admin)', async () => {
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: operatorHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 with valid admin session but invalid CSRF', async () => {
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: 'wrong-csrf-token' }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid csrf');
  });
});

describe('POST /api/admin/queue/tick — body validation', () => {
  it('returns 400 when csrf is missing', async () => {
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/queue/tick — happy path', () => {
  it('returns TickResult shape and writes manual_scheduler_tick audit', async () => {
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      claimed: number;
      done: number;
      pending: number;
      failed: number;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.claimed).toBe('number');
    expect(typeof body.done).toBe('number');
    expect(typeof body.pending).toBe('number');
    expect(typeof body.failed).toBe('number');
    expect(body.done + body.pending + body.failed).toBe(body.claimed);

    // Audit is written fire-and-forget (`void writeAudit(...)`), so poll
    // briefly for it to land. The convention is intentionally async so the
    // hot path doesn't block on the audit insert.
    let audit: Awaited<ReturnType<typeof prisma.auditLog.findFirst>> = null;
    for (let i = 0; i < 20 && audit === null; i += 1) {
      audit = await prisma.auditLog.findFirst({
        where: {
          action: 'manual_scheduler_tick',
          actorUserId: adminUserId,
          createdAt: { gte: TEST_START },
        },
      });
      if (audit === null) await new Promise((r) => setTimeout(r, 50));
    }
    expect(audit).not.toBeNull();
    expect(audit!.targetType).toBe('system');
  });

  it('returns zero claim counts when scheduler is paused', async () => {
    pause();
    const res = await postTick(
      new Request('http://x/api/admin/queue/tick', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: number; done: number; pending: number; failed: number };
    expect(body.claimed).toBe(0);
    expect(body.done).toBe(0);
    expect(body.pending).toBe(0);
    expect(body.failed).toBe(0);
  });
});