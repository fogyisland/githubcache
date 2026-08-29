import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { GET as exportAudit } from '@/app/api/admin/audit/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';

const TEST_EMAIL_PREFIX = 'admin-audit-export-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-audit-export-password';
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

  // Seed rows with values that exercise CSV escaping: a comma in the
  // metadata + a quote in targetId. We use targetId freely since it's
  // free-form text in the schema.
  const seeds = [
    {
      actorUserId: adminUserId,
      action: 'login_success',
      targetType: 'session',
      targetId: 'sess-csv-1',
      metadata: { note: 'with,comma' },
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
      metadata: { label: 'plain' },
      ip: '10.0.0.2',
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
        metadata: s.metadata as Prisma.InputJsonValue,
      },
    });
    seededAuditIds.push(row.id);
  }

  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  sessionCookie = adminLogin.sid;
  const opLogin = await login(OPERATOR_EMAIL, OPERATOR_PASSWORD);
  operatorSessionCookie = opLogin.sid;
}, 30_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { id: { in: seededAuditIds } } });
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: TEST_START } },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.$disconnect();
});

describe('GET /api/admin/audit (export)', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv'),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when operator (not admin) requests csv export', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv', {
        headers: { cookie: operatorSessionCookie },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for unknown format value', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=xml', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/format/);
  });

  it('streams CSV with the canonical header + body rows for format=csv', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toMatch(/filename="audit-.*\.csv"/);

    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(
      'id,createdAt,action,targetType,targetId,actorUserId,actorEmail,ip,metadata',
    );

    // At least the 3 seeded rows must be present (other audit rows from
    // earlier tests may be in the DB; this assertion is subset, not exact).
    const dataLines = lines.slice(1).filter((l) => !l.startsWith('# '));
    expect(dataLines.length).toBeGreaterThanOrEqual(3);

    // Filter for one of our seeds and verify content.
    const loginRow = dataLines.find((l) => l.includes(',login_success,') && l.includes(',sess-csv-1,'));
    expect(loginRow).toBeDefined();
    expect(loginRow).toContain(ADMIN_EMAIL); // actorEmail enrichment
    expect(loginRow).toContain('"with,comma"'); // RFC 4180 comma escaping
  });

  it('escapes double quotes in metadata fields', async () => {
    // Seed a row whose metadata contains a literal " character.
    const row = await prisma.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'quote_test',
        targetType: 'system',
        targetId: 'q-1',
        metadata: { quote: 'he said "hi"' } as Prisma.InputJsonValue,
      },
    });
    seededAuditIds.push(row.id);

    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv&action=quote_test', {
        headers: { cookie: sessionCookie },
      }),
    );
    const text = await res.text();
    // The metadata field is JSON.stringify'd first, then CSV-escaped.
    // JSON.stringify({quote:'he said "hi"'}) → {"quote":"he said \"hi\""}
    // The CSV layer wraps in `"` (because the field contains `,`), then
    // doubles every internal `"` to `""`. The backslashes from JSON's
    // escape sequence are literal in the resulting string. We assert on
    // the substring containing `hi` — the closing braces + outer CSV
    // quote don't matter, just that the doubled-quote pattern is
    // present in the right shape.
    expect(text).toContain('\\""hi\\""');
  });

  it('respects the action filter when exporting CSV', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv&action=login_success', {
        headers: { cookie: sessionCookie },
      }),
    );
    const text = await res.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toMatch(/^id,createdAt,/);
    const dataLines = lines.slice(1).filter((l) => !l.startsWith('# '));
    expect(dataLines.length).toBeGreaterThanOrEqual(1);
    for (const line of dataLines) {
      expect(line).toContain(',login_success,');
    }
  });

  it('respects actorUserId filter when exporting CSV', async () => {
    const res = await exportAudit(
      new Request(
        `http://x/api/admin/audit?format=csv&actorUserId=${operatorUserId.toString()}`,
        { headers: { cookie: sessionCookie } },
      ),
    );
    const text = await res.text();
    expect(text).toContain(`,${operatorUserId.toString()},`);
    // Should not contain the admin's user id from the seeds.
    expect(text).not.toContain(`,${adminUserId.toString()},`);
  });

  it('returns X-Total-Rows + X-Exported-Rows + X-Truncated headers', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=csv', {
        headers: { cookie: sessionCookie },
      }),
    );
    const total = Number(res.headers.get('x-total-rows'));
    const exported = Number(res.headers.get('x-exported-rows'));
    const truncated = res.headers.get('x-truncated');
    expect(total).toBeGreaterThanOrEqual(3);
    expect(exported).toBeGreaterThanOrEqual(3);
    expect(exported).toBeLessThanOrEqual(total);
    expect(['0', '1']).toContain(truncated);
  });

  it('returns the same JSON envelope when format is omitted (back-compat)', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?limit=5', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as {
      rows: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(0);
  });

  it('returns the same JSON envelope when format=json (explicit)', async () => {
    const res = await exportAudit(
      new Request('http://x/api/admin/audit?format=json', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });
});