import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';

const TEST_EMAIL_PREFIX = 'key-requested-email-int-';

let adminIds: bigint[] = [];

beforeAll(async () => {
  // Snapshot all pre-existing active admin IDs so we can disable
  // them for the duration of these tests — otherwise stray admins
  // from other tests would receive emails and skew the assertions.
  const pre = await prisma.user.findMany({
    where: { role: 'admin', status: 'active' },
    select: { id: true },
  });
  adminIds = pre.map((u) => u.id);
  await prisma.user.updateMany({
    where: { id: { in: adminIds } },
    data: { status: 'disabled' },
  });

  // Seed a single admin user to receive the email.
  const admin = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}admin-${Date.now()}@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword('pw'),
    },
  });
  adminIds = [admin.id];
});

afterAll(async () => {
  // Restore pre-existing admins to active.
  await prisma.user.updateMany({
    where: { id: { in: adminIds.filter((id) => id !== adminIds[adminIds.length - 1]) } },
    data: { status: 'active' },
  });
  await prisma.emailLog.deleteMany({
    where: { recipient: { startsWith: TEST_EMAIL_PREFIX } },
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
  await prisma.emailConfig.deleteMany({});
  await prisma.$disconnect();
});

const sendMailMock = vi.fn();
vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
}));

import { keyRequestedTemplate } from '@/lib/email/templates/key-requested';
import { sendKeyRequestedEmail } from '@/lib/email/triggers/key-requested';

describe('key-requested email', () => {
  describe('template', () => {
    it('includes requester email + key name + approve URL', () => {
      const tpl = keyRequestedTemplate({
        apiKeyName: 'my-ci-key',
        requester: { email: 'alice@example.com' },
        description: 'Used by CI to fetch cached metadata',
        approveUrl: 'https://cache.example.com/admin/api-keys/123',
        siteName: 'Test Site',
      });
      expect(tpl.subject).toBe('alice@example.com requested an API key on Test Site');
      expect(tpl.html).toContain('alice@example.com');
      expect(tpl.html).toContain('my-ci-key');
      expect(tpl.html).toContain('Used by CI to fetch cached metadata');
      expect(tpl.html).toContain('https://cache.example.com/admin/api-keys/123');
      expect(tpl.text).toContain('alice@example.com');
      expect(tpl.text).toContain('my-ci-key');
      expect(tpl.text).toContain('https://cache.example.com/admin/api-keys/123');
    });

    it('handles missing description gracefully', () => {
      const tpl = keyRequestedTemplate({
        apiKeyName: 'k',
        requester: { email: 'b@x.test' },
        approveUrl: 'http://x/admin/api-keys/1',
      });
      expect(tpl.html).toContain('(none)');
      expect(tpl.text).toContain('(none)');
    });

    it('escapes HTML special characters in user-controlled fields', () => {
      const tpl = keyRequestedTemplate({
        apiKeyName: '<script>alert(1)</script>',
        requester: { email: 'a@b.test' },
        approveUrl: 'http://x/?q=1&r=2',
      });
      expect(tpl.html).not.toContain('<script>alert(1)</script>');
      expect(tpl.html).toContain('&lt;script&gt;');
    });
  });

  describe('trigger', () => {
    it('emails every active admin and writes email_log rows', async () => {
      sendMailMock.mockReset();
      sendMailMock.mockResolvedValue({ messageId: '<id@host>' });

      // Seed a requester (operator).
      const requester = await prisma.user.create({
        data: {
          email: `${TEST_EMAIL_PREFIX}req-${Date.now()}@example.test`,
          role: 'operator',
          status: 'active',
          passwordHash: await hashPassword('pw'),
          signupSource: 'self',
        },
      });

      // Create a pending ApiKey for them.
      const apiKey = await prisma.apiKey.create({
        data: {
          userId: requester.id,
          name: 'pending-for-email',
          keyPrefix: 'ghc_usr_',
          keyHash: `hash-${Date.now()}`,
          status: 'pending',
        },
      });

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

      const result = await sendKeyRequestedEmail({
        apiKey,
        requester,
        origin: 'https://cache.example.com',
      });

      expect(result.sent).toBeGreaterThan(0);
      expect(sendMailMock).toHaveBeenCalledTimes(result.sent);
      const firstArgs = sendMailMock.mock.calls[0]![0] as { to: string; subject: string };
      expect(firstArgs.subject).toContain('requested an API key');
      expect(firstArgs.to).toMatch(/@example\.test$/);

      // Confirm email_log row was written with templateKey='key-requested'
      const logs = await prisma.emailLog.findMany({
        where: { templateKey: 'key-requested' },
      });
      expect(logs.length).toBeGreaterThan(0);

      // Cleanup
      await prisma.emailLog.deleteMany({
        where: { templateKey: 'key-requested', recipient: { startsWith: TEST_EMAIL_PREFIX } },
      });
      await prisma.apiKey.deleteMany({ where: { id: apiKey.id } });
      await prisma.user.deleteMany({ where: { id: requester.id } });
      await prisma.emailConfig.deleteMany({});
    });

    it('returns sent=0 when no active admins exist', async () => {
      // Disable the admin we created in beforeAll.
      await prisma.user.update({
        where: { id: adminIds[adminIds.length - 1]! },
        data: { status: 'disabled' },
      });

      const requester = await prisma.user.create({
        data: {
          email: `${TEST_EMAIL_PREFIX}req2-${Date.now()}@example.test`,
          role: 'operator',
          status: 'active',
          passwordHash: await hashPassword('pw'),
        },
      });
      const apiKey = await prisma.apiKey.create({
        data: {
          userId: requester.id,
          name: 'k',
          keyPrefix: 'ghc_usr_',
          keyHash: `h-${Date.now()}`,
          status: 'pending',
        },
      });

      const result = await sendKeyRequestedEmail({
        apiKey,
        requester,
        origin: 'https://x.test',
      });

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);

      // Cleanup
      await prisma.user.update({
        where: { id: adminIds[adminIds.length - 1]! },
        data: { status: 'active' },
      });
      await prisma.apiKey.deleteMany({ where: { id: apiKey.id } });
      await prisma.user.deleteMany({ where: { id: requester.id } });
    });
  });
});
