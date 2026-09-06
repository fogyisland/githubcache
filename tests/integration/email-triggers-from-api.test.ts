import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postInvite } from '@/app/api/admin/users/invite/route';
import { POST as postResetPassword } from '@/app/api/admin/users/[id]/reset-password/route';
import { POST as postApprove } from '@/app/api/admin/api-keys/[id]/approve/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'email-triggers-from-api-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'pw';
const OPERATOR_EMAIL = `${TEST_EMAIL_PREFIX}op-${Date.now()}@example.test`;
const OPERATOR_PASSWORD = 'pw';

let adminUserId: bigint;
let operatorUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

const sendMailMock = vi.fn();
vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
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

  // Seed email_config so triggers find a transport
  await prisma.emailConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      smtpHost: 'smtp.test',
      smtpPort: 587,
      smtpUser: 'u',
      smtpPass: 'p',
      smtpFrom: 'no-reply@test',
    },
    update: {},
  });

  // Login
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
  if (csrfLine !== undefined) {
    csrfCookie = csrfLine.split(';')[0] ?? '';
    csrfToken = csrfCookie.slice('ghc_csrf='.length);
  }
}, 30_000);

afterAll(async () => {
  await prisma.emailLog.deleteMany({
    where: { OR: [
      { recipient: { startsWith: TEST_EMAIL_PREFIX } },
      { subject: { contains: 'is approved' } },
    ] },
  });
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  await prisma.invitation.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.apiKey.deleteMany({ where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.emailConfig.deleteMany({});
  await prisma.$disconnect();
});

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: '<id@host>' });
});

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    cookie: `${csrfCookie}; ${sessionCookie}`,
    'x-csrf-token': csrfToken,
    ...extra,
  };
}

describe('API routes wire email triggers', () => {
  it('POST /api/admin/users/invite returns emailSent:true + writes email_log', async () => {
    const newEmail = `${TEST_EMAIL_PREFIX}invitee-${Date.now()}@example.test`;
    const res = await postInvite(
      new Request('http://x/api/admin/users/invite', {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ email: newEmail, role: 'operator', csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inviteLink: string; emailSent: boolean };
    expect(body.emailSent).toBe(true);
    expect(body.inviteLink).toContain('/request-access?invitation=');

    const logs = await prisma.emailLog.findMany({
      where: { recipient: newEmail, templateKey: 'invite' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe('sent');
  });

  it('POST /api/admin/users/[id]/reset-password returns emailSent:true + writes email_log', async () => {
    const res = await postResetPassword(
      new Request(`http://x/api/admin/users/${operatorUserId}/reset-password`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(operatorUserId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tempPassword: string; emailSent: boolean };
    expect(body.emailSent).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.tempPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);

    const logs = await prisma.emailLog.findMany({
      where: { recipient: OPERATOR_EMAIL, templateKey: 'password-reset' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe('sent');
  });

  it('POST /api/admin/api-keys/[id]/approve returns emailSent:true + writes email_log', async () => {
    // Create a pending key for the operator
    const key = await prisma.apiKey.create({
      data: {
        userId: operatorUserId,
        name: 'test-key',
        keyPrefix: 'pending',
        keyHash: 'placeholder',
        status: 'pending',
      },
    });
    const res = await postApprove(
      new Request(`http://x/api/admin/api-keys/${key.id}/approve`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ csrf: csrfToken }),
      }),
      { params: { id: String(key.id) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; plain: string; emailSent: boolean };
    expect(body.emailSent).toBe(true);
    expect(body.plain).toMatch(/^ghc_/);

    const logs = await prisma.emailLog.findMany({
      where: { recipient: OPERATOR_EMAIL, templateKey: 'api-key-approved' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe('sent');
    // The audit + email log's relatedEntityId is the key owner (the operator).
    expect(logs[0]!.relatedEntityId).toBe(operatorUserId.toString());
    // The admin (approver) is the actor — exercise adminUserId via audit.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'approve_key', targetId: String(key.id) },
    });
    expect(audits[0]!.actorUserId).toBe(adminUserId);
  });
});
