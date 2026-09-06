import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postRefresh } from '@/app/api/admin/refresh/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import type { Repository } from '@prisma/client';
import { pause, resume, isPaused } from '@/lib/scheduler/state';
import { runTick } from '@/lib/scheduler/tick';

const TEST_EMAIL_PREFIX = 'admin-refresh-int-';
const REPO_OWNER_PREFIX = 'admin-refresh-int-repo-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-refresh-password';
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

let testRepo: Repository;

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

  // Login admin
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;
  csrfCookie = `ghc_csrf=${adminLogin.csrf}`;
  csrfToken = adminLogin.csrf;

  // Login operator
  const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  operatorSessionCookie = opLogin.sid;
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
        { action: { in: ['manual_refresh_trigger', 'scheduler_paused', 'scheduler_resumed'] } },
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
  // Resume in case a prior test left the scheduler paused
  resume();
  // Recreate test repo (trigger tests will create jobs against it)
  await prisma.refreshJob.deleteMany({
    where: { repository: { owner: { startsWith: REPO_OWNER_PREFIX } } },
  });
  await prisma.repository.deleteMany({
    where: { owner: { startsWith: REPO_OWNER_PREFIX } },
  });
  testRepo = await prisma.repository.create({
    data: {
      owner: `${REPO_OWNER_PREFIX}1`,
      name: 'refresh-target',
      node: { id: 99_111_001 },
      // M27 — defaultBranch is NOT NULL in the schema.
      defaultBranch: 'main',
      fetchStatus: 'ok',
    },
  });
});

// Mock pickToken so runTick doesn't actually hit GitHub when we test the
// tick-skip-when-paused behavior.
vi.mock('@/lib/github/pool', () => ({
  initPool: vi.fn(() => Promise.resolve()),
  pickToken: vi.fn(() => null), // null → refreshOne returns failure (job stays pending)
  recordUsage: vi.fn(() => Promise.resolve()),
  getBackoff: vi.fn(() => 10),
  shutdownPool: vi.fn(() => Promise.resolve()),
  poolSize: vi.fn(() => 0),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('POST /api/admin/refresh — auth & role gating', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pause', csrf: 'whatever' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when operator (not admin)', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: operatorHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'pause', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 with valid admin session but invalid CSRF', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'pause', csrf: 'wrong-csrf-token' }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid csrf');
  });
});

describe('POST /api/admin/refresh — action validation', () => {
  it('returns 400 for invalid body', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ wrong: 'shape' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('trigger returns 400 when repoId missing', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'trigger', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('repoId required');
  });

  it('trigger returns 400 for non-numeric repoId', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'trigger', repoId: 'not-a-number', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid repoId');
  });

  it('trigger returns 404 for non-existent repoId', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          action: 'trigger',
          repoId: '999999999999999',
          csrf: csrfToken,
        }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('repository not found');
  });
});

describe('POST /api/admin/refresh — trigger happy path', () => {
  it('creates refresh_jobs row with priority=10 and writes audit', async () => {
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          action: 'trigger',
          repoId: testRepo.id.toString(),
          csrf: csrfToken,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobId: string };
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe('string');

    // Verify the refresh_jobs row
    const job = await prisma.refreshJob.findUnique({ where: { id: BigInt(body.jobId) } });
    expect(job).not.toBeNull();
    expect(job!.repositoryId).toBe(testRepo.id);
    expect(job!.priority).toBe(10);
    expect(job!.status).toBe('pending');
    expect(job!.attempts).toBe(0);
    expect(job!.lockedUntil).toBeNull();
    expect(job!.lastError).toBeNull();

    // Verify audit (fire-and-forget per M6.3 — assert >= 1 after a brief wait)
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'manual_refresh_trigger', targetId: testRepo.id.toString() },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    // Metadata should include repoId + priority (per brief line 74)
    const meta = audits[0]!.metadata as { repoId: string; priority: number; jobId?: string } | null;
    expect(meta).not.toBeNull();
    expect(meta!.repoId).toBe(testRepo.id.toString());
    expect(meta!.priority).toBe(10);
    expect(meta!.jobId).toBe(body.jobId);
  });
});

describe('POST /api/admin/refresh — pause / resume', () => {
  it('pause sets the flag and writes audit', async () => {
    expect(isPaused()).toBe(false);
    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'pause', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    expect(isPaused()).toBe(true);

    // Verify audit
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'scheduler_paused', targetId: 'scheduler' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    const meta = audits[0]!.metadata as { pausedAt: string } | null;
    expect(meta).not.toBeNull();
    expect(typeof meta!.pausedAt).toBe('string');
  });

  it('resume clears the flag and writes audit', async () => {
    // First pause
    pause();
    expect(isPaused()).toBe(true);

    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'resume', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    expect(isPaused()).toBe(false);

    // Verify audit
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'scheduler_resumed', targetId: 'scheduler' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    const meta = audits[0]!.metadata as { resumedAt: string } | null;
    expect(meta).not.toBeNull();
    expect(typeof meta!.resumedAt).toBe('string');
  });

  it('pause is idempotent — calling twice does not error', async () => {
    const first = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'pause', csrf: csrfToken }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'pause', csrf: csrfToken }),
      }),
    );
    expect(second.status).toBe(200);
    expect(isPaused()).toBe(true);
  });

  it('resume is idempotent — calling when not paused does not error', async () => {
    // Sanity: not paused
    expect(isPaused()).toBe(false);

    const res = await postRefresh(
      new Request('http://x/api/admin/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ action: 'resume', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    expect(isPaused()).toBe(false);
  });
});

describe('scheduler tick skip-when-paused', () => {
  it('runTick does not claim jobs when paused', async () => {
    // Seed a pending job that would normally be claimed
    const job = await prisma.refreshJob.create({
      data: {
        repositoryId: testRepo.id,
        priority: 1, // highest priority — would definitely be claimed if not paused
        scheduledFor: new Date(Date.now() - 1000),
        status: 'pending',
        attempts: 0,
      },
    });

    // Pause and run tick
    pause();
    expect(isPaused()).toBe(true);
    const result = await runTick();
    expect(result.claimed).toBe(0);
    expect(result.done).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.failed).toBe(0);

    // Job must remain untouched (status=pending, attempts=0, no lock)
    const after = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    expect(after!.status).toBe('pending');
    expect(after!.attempts).toBe(0);
    expect(after!.lockedUntil).toBeNull();

    // Resume and tick — job SHOULD now be claimed/processed
    resume();
    await runTick();
    const afterResume = await prisma.refreshJob.findUnique({ where: { id: job.id } });
    // Either failed (no token — mocked to return null) or claimed (someone else filled)
    // The critical assertion is that attempts incremented → proves the tick DID claim it
    expect(afterResume!.attempts).toBeGreaterThanOrEqual(1);
  });
});
