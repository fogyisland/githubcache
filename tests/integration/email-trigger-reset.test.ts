import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { sendPasswordResetEmail } from '@/lib/email/triggers/password-reset';

const TEST_EMAIL_PREFIX = 'email-trigger-reset-int-';

let userId: bigint;
const sendMailMock = vi.fn();

vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
}));

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}alice@example.test`,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword('pw'),
    },
  });
  userId = u.id;
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
}, 30_000);

afterAll(async () => {
  await prisma.emailLog.deleteMany({
    where: { recipient: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.emailConfig.deleteMany({});
  await prisma.$disconnect();
});

beforeEach(() => {
  sendMailMock.mockReset();
});

describe('sendPasswordResetEmail', () => {
  it('sends email with temp password + log row', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: '<reset@host>' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();

    const result = await sendPasswordResetEmail(user!, 'AbcDefGhi12345', 'https://cache.example.com');
    expect(result.ok).toBe(true);
    const args = sendMailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['to']).toBe(user!.email);
    expect(String(args['html'])).toContain('AbcDefGhi12345');
    expect(String(args['text'])).toContain('AbcDefGhi12345');

    const logs = await prisma.emailLog.findMany({
      where: { recipient: user!.email, templateKey: 'password-reset' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe('sent');
    expect(logs[0]!.relatedEntityType).toBe('user');
  });

  it('returns not_configured when SMTP not configured', async () => {
    await prisma.emailConfig.deleteMany({});
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const result = await sendPasswordResetEmail(user!, 'pw', 'https://cache.example.com');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_configured');

    // Re-seed
    await prisma.emailConfig.create({
      data: {
        id: 1,
        smtpHost: 'smtp.test',
        smtpPort: 587,
        smtpUser: 'u',
        smtpPass: 'p',
        smtpFrom: 'no-reply@test',
      },
    });
  });
});
