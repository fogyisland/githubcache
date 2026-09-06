import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/client';
import { createInvitation } from '@/lib/db/invitations';

const TEST_EMAIL_PREFIX = 'email-trigger-invite-int-';
const TEST_START = new Date();

let inviterId: bigint;

const sendMailMock = vi.fn();
vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
}));

// Imported AFTER the transport mock so the module reads it.
import { sendInviteEmail } from '@/lib/email/triggers/invite';

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}inviter@example.test`,
      role: 'admin',
      status: 'active',
      passwordHash: await hashPassword('pw'),
    },
  });
  inviterId = u.id;
  // Seed config so the trigger can find a transport
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
  await prisma.invitation.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.emailConfig.deleteMany({});
  await prisma.$disconnect();
});

beforeEach(() => {
  sendMailMock.mockReset();
});

describe('sendInviteEmail', () => {
  it('sends to invitee with invitation link + writes email_log row', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: '<invite@host>' });
    const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
    expect(inviter).not.toBeNull();
    const invitation = await createInvitation(
      `${TEST_EMAIL_PREFIX}bob@example.test`,
      'operator',
      inviterId,
    );

    const result = await sendInviteEmail(invitation, inviter!, 'https://cache.example.com');

    expect(result.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const args = sendMailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['to']).toBe(`${TEST_EMAIL_PREFIX}bob@example.test`);
    const html = String(args['html']);
    expect(html).toContain('/request-access?invitation=' + invitation.id);
    expect(html).toContain('https://cache.example.com');

    // Log row written with templateKey='invite'
    const logs = await prisma.emailLog.findMany({
      where: { recipient: invitation.email, templateKey: 'invite' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe('sent');
    expect(logs[0]!.relatedEntityType).toBe('invitation');
    expect(logs[0]!.relatedEntityId).toBe(invitation.id);
  });

  it('returns ok:false with not_configured when email_config row missing', async () => {
    await prisma.emailConfig.deleteMany({});
    const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
    const invitation = await createInvitation(
      `${TEST_EMAIL_PREFIX}no-config@example.test`,
      'operator',
      inviterId,
    );

    const result = await sendInviteEmail(invitation, inviter!, 'https://cache.example.com');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('not_configured');

    // Re-seed for other tests in the file
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

  it('marks email_log failed when transport throws', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'));
    const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
    const invitation = await createInvitation(
      `${TEST_EMAIL_PREFIX}fail@example.test`,
      'operator',
      inviterId,
    );

    const result = await sendInviteEmail(invitation, inviter!, 'https://cache.example.com');
    expect(result.ok).toBe(false);
    const logs = await prisma.emailLog.findMany({
      where: { recipient: invitation.email, templateKey: 'invite' },
    });
    const latest = logs.sort((a, b) => Number(b.id - a.id))[0]!;
    expect(latest.status).toBe('failed');
    expect(latest.errorMessage).toBe('smtp down');
  });

  // Touch to silence unused-var warning
  void TEST_START;
});
