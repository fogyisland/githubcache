import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import {
  GET as listTokens,
  POST as postToken,
} from '@/app/api/admin/github-tokens/route';
import {
  PATCH as patchToken,
  DELETE as deleteToken,
} from '@/app/api/admin/github-tokens/[id]/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { createHash } from 'crypto';

const TEST_EMAIL_PREFIX = 'admin-gh-tokens-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-gh-tokens-password';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}operator-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'operator-password';
const TEST_START = new Date();

let adminUserId: bigint;
let operatorUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

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

function csrfOnlyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: csrfCookie,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

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

  // Login as admin
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;
  // Re-issue CSRF after login (the Set-Cookie from login may have rotated it)
  const csrfRes = await getCsrf();
  csrfCookie = (csrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const csrfBody = (await csrfRes.json()) as { csrfToken: string };
  csrfToken = csrfBody.csrfToken;
}, 30_000);

afterAll(async () => {
  // Clean up: github_tokens → audit → sessions → users
  await prisma.githubToken.deleteMany({
    where: { label: { startsWith: 'gh-int-' } },
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
  // Wipe tokens between tests
  await prisma.githubToken.deleteMany({
    where: { label: { startsWith: 'gh-int-' } },
  });
  // Ensure operator is active
  await prisma.user.update({
    where: { id: operatorUserId },
    data: { status: 'active' },
  });
  await prisma.session.deleteMany({ where: { userId: operatorUserId } });
});

describe('GET /api/admin/github-tokens', () => {
  it('returns the list and allows an operator (per spec §9.1 admin OR operator)', async () => {
    // Seed one token first (admin creates it)
    const raw = 'ghp_seedtoken-' + Math.random().toString(36).slice(2, 10);
    const seedRes = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-seed', token: raw, csrf: csrfToken }),
      }),
    );
    expect(seedRes.status).toBe(200);

    // Operator login + GET
    const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const opCsrfRes = await getCsrf();
    const opCsrfCookie = (opCsrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const res = await listTokens(
      new Request('http://x/api/admin/github-tokens', {
        headers: {
          cookie: `${opCsrfCookie}; ${opLogin.sid}`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: Array<{ label: string }> };
    const ours = body.tokens.filter((t) => t.label === 'gh-int-seed');
    expect(ours.length).toBe(1);
  });

  it('returns 403 when not authenticated', async () => {
    // No cookie at all (only csrf cookie — still no session)
    const res = await listTokens(
      new Request('http://x/api/admin/github-tokens', {
        headers: csrfOnlyHeaders(),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/github-tokens', () => {
  it('happy path: computes first4/last4/hash, inserts row, audits register_token', async () => {
    const raw = 'ghp_aabbccddee11223344556677889900aabb';
    const res = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-happy', token: raw, csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string; message: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^\d+$/);
    expect(body.message).toContain('Activate');

    // Verify row in DB
    const row = await prisma.githubToken.findUnique({ where: { id: BigInt(body.id) } });
    expect(row).not.toBeNull();
    expect(row!.label).toBe('gh-int-happy');
    expect(row!.tokenFirst4).toBe('ghp_');
    expect(row!.tokenLast4).toBe('aabb'); // last 4 of `ghp_aabbccddee11223344556677889900aabb`
    const expectedHash = createHash('sha256').update(raw).digest('hex');
    expect(row!.tokenHash).toBe(expectedHash);

    // Audit
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'register_token', targetId: body.id },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    const meta = audits[0]!.metadata as { label: string; first4: string; last4: string };
    expect(meta.label).toBe('gh-int-happy');
    expect(meta.first4).toBe('ghp_');
    expect(meta.last4).toBe('aabb');
  });

  it('returns 409 for a duplicate token hash', async () => {
    const raw = 'ghp_dddeeefffggghhhiiijjjkkklllmmmnnn';
    const first = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-dup-1', token: raw, csrf: csrfToken }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-dup-2', token: raw, csrf: csrfToken }),
      }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('token already registered');
  });

  it('returns 400 for a token shorter than 20 chars', async () => {
    const res = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-short', token: 'ghp_short', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for an operator (admin-only mutation)', async () => {
    const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const opCsrfRes = await getCsrf();
    const opCsrfCookie = (opCsrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const opCsrfBody = (await opCsrfRes.json()) as { csrfToken: string };
    const opCsrfToken = opCsrfBody.csrfToken;

    const res = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${opCsrfCookie}; ${opLogin.sid}`,
          'x-csrf-token': opCsrfToken,
        },
        body: JSON.stringify({
          label: 'gh-int-op',
          token: 'ghp_aabbccddee112233445566778899',
          csrf: opCsrfToken,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

// Race-window test: when two concurrent POSTs both pass the dup check
// before either inserts, the DB unique constraint makes the loser's
// insertToken throw P2002. The route's try/catch must convert that to 409
// instead of letting it surface as a 500.
//
// We can't reliably force the race timing in a Vitest test (would require
// mocking listAllTokens), so we exercise the failure mode end-to-end:
// seed the row directly via Prisma (so the unique constraint exists),
// then POST the same plaintext. The route's dup-check catches the seeded
// row and returns 409 — but we ALSO verify that insertToken throws P2002
// when the constraint is violated, proving the catch block will fire in a
// true race window.
describe('POST /api/admin/github-tokens — race-window P2002', () => {
  it('insertToken throws P2002 on duplicate hash, and the route returns 409 not 500', async () => {
    const raw = 'ghp_racewindow1111222233334444555566667';
    const hash = createHash('sha256').update(raw).digest('hex');
    await prisma.githubToken.create({
      data: {
        label: 'gh-int-race-seed',
        tokenFirst4: raw.slice(0, 4),
        tokenLast4: raw.slice(-4),
        tokenHash: hash,
        status: 'active',
      },
    });

    // 1. Direct insertToken call: must throw P2002 (constraint enforced).
    const { insertToken } = await import('@/lib/db/github-tokens');
    let caught: unknown = null;
    try {
      await insertToken({
        label: 'gh-int-race-loser',
        tokenFirst4: raw.slice(0, 4),
        tokenLast4: raw.slice(-4),
        tokenHash: hash,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code?: string }).code).toBe('P2002');

    // 2. End-to-end: POST the same plaintext. The route's dup-check catches
    //    it and returns 409. (In a true race, the dup check would pass and
    //    insertToken would throw P2002, which the new try/catch now maps
    //    to the same 409 — both paths converge.)
    const res = await postToken(
      new Request('http://x/api/admin/github-tokens', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ label: 'gh-int-race-post', token: raw, csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('token already registered');
  }, 15_000);
});

describe('PATCH /api/admin/github-tokens/[id]', () => {
  async function makeTokenRow(): Promise<bigint> {
    const raw = 'ghp_paaaaaabbbbbbccccccddddddeeeeee';
    const hash = createHash('sha256').update(raw).digest('hex');
    const row = await prisma.githubToken.create({
      data: {
        label: 'gh-int-patch',
        tokenFirst4: raw.slice(0, 4),
        tokenLast4: raw.slice(-4),
        tokenHash: hash,
        status: 'active',
      },
    });
    return row.id;
  }

  it('disables a token and writes disable_token audit', async () => {
    const id = await makeTokenRow();

    const res = await patchToken(
      new Request(`http://x/api/admin/github-tokens/${id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ status: 'disabled', csrf: csrfToken }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);

    const after = await prisma.githubToken.findUnique({ where: { id } });
    expect(after!.status).toBe('disabled');

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'disable_token', targetId: String(id) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    const meta = audits[0]!.metadata as { before: string; after: string };
    expect(meta.before).toBe('active');
    expect(meta.after).toBe('disabled');
  });

  it('returns 403 for an operator', async () => {
    const id = await makeTokenRow();
    const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const opCsrfRes = await getCsrf();
    const opCsrfCookie = (opCsrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const opCsrfBody = (await opCsrfRes.json()) as { csrfToken: string };
    const opCsrfToken = opCsrfBody.csrfToken;

    const res = await patchToken(
      new Request(`http://x/api/admin/github-tokens/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: `${opCsrfCookie}; ${opLogin.sid}`,
          'x-csrf-token': opCsrfToken,
        },
        body: JSON.stringify({ status: 'disabled', csrf: opCsrfToken }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(403);

    // Verify DB was not touched
    const after = await prisma.githubToken.findUnique({ where: { id } });
    expect(after!.status).toBe('active');
  });
});

describe('DELETE /api/admin/github-tokens/[id]', () => {
  async function makeTokenRow(): Promise<bigint> {
    const raw = 'ghp_daaaaaaabbbbbbccccccddddddeeeeee';
    const hash = createHash('sha256').update(raw).digest('hex');
    const row = await prisma.githubToken.create({
      data: {
        label: 'gh-int-delete',
        tokenFirst4: raw.slice(0, 4),
        tokenLast4: raw.slice(-4),
        tokenHash: hash,
        status: 'active',
      },
    });
    return row.id;
  }

  it('removes the row and writes delete_token audit', async () => {
    const id = await makeTokenRow();

    const res = await deleteToken(
      new Request(`http://x/api/admin/github-tokens/${id}`, {
        method: 'DELETE',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(200);

    // Verify row gone
    const after = await prisma.githubToken.findUnique({ where: { id } });
    expect(after).toBeNull();

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'delete_token', targetId: String(id) },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.actorUserId).toBe(adminUserId);
    const meta = audits[0]!.metadata as { label: string; first4: string; last4: string };
    expect(meta.label).toBe('gh-int-delete');
    expect(meta.first4).toBe('ghp_');
  });

  it('returns 403 for an operator', async () => {
    const id = await makeTokenRow();
    const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const opCsrfRes = await getCsrf();
    const opCsrfCookie = (opCsrfRes.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const opCsrfBody = (await opCsrfRes.json()) as { csrfToken: string };
    const opCsrfToken = opCsrfBody.csrfToken;

    const res = await deleteToken(
      new Request(`http://x/api/admin/github-tokens/${id}`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          cookie: `${opCsrfCookie}; ${opLogin.sid}`,
          'x-csrf-token': opCsrfToken,
        },
        body: JSON.stringify({ csrf: opCsrfToken }),
      }),
      { params: { id: String(id) } },
    );
    expect(res.status).toBe(403);

    // Verify row still exists
    const after = await prisma.githubToken.findUnique({ where: { id } });
    expect(after).not.toBeNull();
  });
});
