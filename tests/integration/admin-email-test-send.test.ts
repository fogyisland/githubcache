import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { POST as postTestSend } from '@/app/api/admin/email/test/route';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';

const TEST_EMAIL_PREFIX = 'admin-email-test-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-email-test-pw';

let adminUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

const sendMailMock = vi.fn();
vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
}));

vi.mock('@/lib/db/client', async (importOriginal) => {
  const mod = (await importOriginal()) as { prisma: typeof prisma };
  return mod;
});

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

  // Seed an email_config row so the test route resolves a transport
  await prisma.emailConfig.create({
    data: {
      id: 1,
      smtpHost: 'smtp.test',
      smtpPort: 587,
      smtpUser: 'u',
      smtpPass: 'p',
      smtpFrom: 'from@test',
    },
  });

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
    where: { recipient: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.emailConfig.deleteMany({});
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  sendMailMock.mockReset();
});

describe('POST /api/admin/email/test', () => {
  it('sends a test email and writes a log row', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: '<test@host>' });

    const res = await postTestSend(
      new Request('http://x/api/admin/email/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${csrfCookie}; ${sessionCookie}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId?: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe('<test@host>');
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    // Log row written
    const logs = await prisma.emailLog.findMany({
      where: { recipient: ADMIN_EMAIL, templateKey: 'test' },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.status).toBe('sent');
    expect(logs[0]!.relatedEntityId).toBe(adminUserId.toString());
  });

  it('returns 403 without auth', async () => {
    const res = await postTestSend(
      new Request('http://x/api/admin/email/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: csrfCookie,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 with not_configured when no email_config row', async () => {
    await prisma.emailConfig.deleteMany({});

    const res = await postTestSend(
      new Request('http://x/api/admin/email/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `${csrfCookie}; ${sessionCookie}`,
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ csrf: csrfToken }),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('not_configured');

    // Restore for any subsequent tests
    await prisma.emailConfig.create({
      data: {
        id: 1,
        smtpHost: 'smtp.test',
        smtpPort: 587,
        smtpUser: 'u',
        smtpPass: 'p',
        smtpFrom: 'from@test',
      },
    });
  });
});

// adminUserId is referenced in the test assertion above (relatedEntityId
// must equal the admin's id). Kept as a void to satisfy type narrowing
// in beforeAll.
