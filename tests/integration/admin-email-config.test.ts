import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GET as getCsrf } from '@/app/api/admin/auth/csrf/route';
import { POST as postLogin } from '@/app/api/admin/auth/login/route';
import { saveEmailConfigAction } from '@/app/admin/email/_actions/save-config';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { vi } from 'vitest';

const TEST_EMAIL_PREFIX = 'admin-email-config-int-';
const ADMIN_EMAIL = `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`;
const ADMIN_PASSWORD = 'admin-email-config-pw';
const TEST_START = new Date();

let adminUserId: bigint;
let csrfCookie = '';
let csrfToken = '';
let sessionCookie = '';

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
  await prisma.emailConfig.deleteMany({});
  await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: TEST_START }, action: { in: ['save_email_config'] } },
  });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Reset email_config between tests
  await prisma.emailConfig.deleteMany({});
});

// Mock next/headers cookies() so the server action can read CSRF/session.
vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [
      { name: 'ghc_csrf', value: csrfToken },
      { name: 'ghc_admin_sid', value: sessionCookie.slice('ghc_admin_sid='.length) },
    ],
    set: vi.fn(),
  }),
  headers: () => new Headers({ cookie: `ghc_csrf=${csrfToken}; ${sessionCookie}` }),
}));

// Stub revalidatePath (server-action only)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('saveEmailConfigAction', () => {
  it('inserts a new row on first save with all fields', async () => {
    const fd = new FormData();
    fd.set('csrf', csrfToken);
    fd.set('smtp_host', 'smtp.example.com');
    fd.set('smtp_port', '587');
    fd.set('smtp_user', 'user@example.com');
    fd.set('smtp_pass', 'secret');
    fd.set('smtp_secure', 'off');
    fd.set('smtp_from', 'no-reply@example.com');
    fd.set('reply_to', 'support@example.com');

    const result = await saveEmailConfigAction({ status: 'idle' }, fd);
    expect(result.status).toBe('ok');

    const row = await prisma.emailConfig.findUnique({ where: { id: 1 } });
    expect(row).not.toBeNull();
    expect(row!.smtpHost).toBe('smtp.example.com');
    expect(row!.smtpPort).toBe(587);
    expect(row!.smtpUser).toBe('user@example.com');
    expect(row!.smtpPass).toBe('secret');
    expect(row!.smtpSecure).toBe(false);
    expect(row!.smtpFrom).toBe('no-reply@example.com');
    expect(row!.replyTo).toBe('support@example.com');

    // Audit metadata records fieldsChanged but NEVER smtp_pass
    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'save_email_config' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const meta = audits[0]!.metadata as Record<string, unknown>;
    const fields = (meta['fieldsChanged'] as string[]) ?? [];
    expect(fields).toContain('created');
    expect(fields).not.toContain('smtp_pass');
    expect(JSON.stringify(meta)).not.toContain('secret');
  });

  it('requires smtp_pass on first save', async () => {
    const fd = new FormData();
    fd.set('csrf', csrfToken);
    fd.set('smtp_host', 'smtp.example.com');
    fd.set('smtp_port', '587');
    fd.set('smtp_user', 'user');
    fd.set('smtp_pass', '');
    fd.set('smtp_from', 'no-reply@example.com');

    const result = await saveEmailConfigAction({ status: 'idle' }, fd);
    expect(result.status).toBe('invalid');
    expect(result.message).toMatch(/smtp_pass/);
  });

  it('preserves existing smtp_pass when blank on update', async () => {
    // Seed an existing row
    await prisma.emailConfig.create({
      data: {
        id: 1,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'u',
        smtpPass: 'OLD_PW',
        smtpSecure: false,
        smtpFrom: 'a@x',
      },
    });
    const fd = new FormData();
    fd.set('csrf', csrfToken);
    fd.set('smtp_host', 'smtp.example.com');
    fd.set('smtp_port', '587');
    fd.set('smtp_user', 'u');
    fd.set('smtp_pass', ''); // blank → preserve
    fd.set('smtp_from', 'a@x');

    const result = await saveEmailConfigAction({ status: 'idle' }, fd);
    expect(result.status).toBe('ok');

    const row = await prisma.emailConfig.findUnique({ where: { id: 1 } });
    expect(row!.smtpPass).toBe('OLD_PW');

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'save_email_config' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = audits[0]!.metadata as Record<string, unknown>;
    const fields = (meta['fieldsChanged'] as string[]) ?? [];
    expect(fields).not.toContain('smtp_pass');
  });

  it('rejects invalid input', async () => {
    const fd = new FormData();
    fd.set('csrf', csrfToken);
    fd.set('smtp_host', '');
    fd.set('smtp_port', '99999');
    fd.set('smtp_user', 'u');
    fd.set('smtp_pass', 'p');
    fd.set('smtp_from', 'from@example.com');

    const result = await saveEmailConfigAction({ status: 'idle' }, fd);
    expect(result.status).toBe('invalid');
  });

  it('audit records fieldsChanged including smtp_pass ONLY when it was changed', async () => {
    await prisma.emailConfig.create({
      data: {
        id: 1,
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'u',
        smtpPass: 'OLD_PW',
        smtpSecure: false,
        smtpFrom: 'a@x',
      },
    });
    const fd = new FormData();
    fd.set('csrf', csrfToken);
    fd.set('smtp_host', 'smtp.example.com');
    fd.set('smtp_port', '587');
    fd.set('smtp_user', 'u');
    fd.set('smtp_pass', 'NEW_PW'); // explicit update
    fd.set('smtp_from', 'a@x');

    const result = await saveEmailConfigAction({ status: 'idle' }, fd);
    expect(result.status).toBe('ok');
    expect(result.fieldsChanged).toContain('smtp_pass');

    await new Promise((r) => setTimeout(r, 100));
    const audits = await prisma.auditLog.findMany({
      where: { action: 'save_email_config' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = audits[0]!.metadata as Record<string, unknown>;
    // Even when fieldsChanged lists smtp_pass, the actual NEW password
    // value must NOT appear in audit metadata.
    expect(JSON.stringify(meta)).not.toContain('NEW_PW');
    // The audit's actorUserId is the admin performing the save.
    expect(audits[0]!.actorUserId).toBe(adminUserId);
  });
});
