import { describe, expect, it, beforeEach, vi } from 'vitest';

const sendMailMock = vi.fn();

vi.mock('@/lib/email/transport', () => ({
  createTransport: () => ({
    sendMail: (...args: unknown[]) => sendMailMock(...args),
  }),
}));

vi.mock('@/lib/db/client', () => {
  let nextId = 1n;
  const logRows: Array<{
    id: bigint;
    recipient: string;
    subject: string;
    templateKey: string;
    status: string;
    errorMessage: string | null;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }> = [];

  return {
    prisma: {
      emailConfig: {
        findUnique: async () => ({
          id: 1,
          smtpHost: 'smtp.test',
          smtpPort: 587,
          smtpUser: 'user@test',
          smtpPass: 'pw',
          smtpSecure: false,
          smtpFrom: 'from@test',
          replyTo: null,
          updatedAt: new Date(),
          updatedBy: null,
        }),
      },
      emailLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: nextId++,
            recipient: String(data['recipient']),
            subject: String(data['subject']),
            templateKey: String(data['templateKey']),
            status: String(data['status'] ?? 'queued'),
            errorMessage: (data['errorMessage'] as string | null | undefined) ?? null,
            relatedEntityType: (data['relatedEntityType'] as string | null | undefined) ?? null,
            relatedEntityId: (data['relatedEntityId'] as string | null | undefined) ?? null,
            sentAt: (data['sentAt'] as Date | null | undefined) ?? null,
            createdAt: new Date(),
          };
          logRows.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
          const row = logRows.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      },
      __logRows: logRows,
    },
  };
});

import { prisma } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/sender';

const logRows = (prisma as unknown as { __logRows: Array<Record<string, unknown>> }).__logRows;

beforeEach(() => {
  sendMailMock.mockReset();
  logRows.length = 0;
});

describe('sendEmail', () => {
  it('inserts a queued log row, then marks it sent on success', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: '<msg@host>' });

    const result = await sendEmail({
      to: 'a@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
      templateKey: 'test',
      relatedEntity: { type: 'user', id: '42' },
    });

    expect(result.ok).toBe(true);
    expect(result.logId).toBe(1n);
    expect(logRows).toHaveLength(1);
    const row = logRows[0]!;
    expect(row['status']).toBe('sent');
    expect(row['errorMessage']).toBeNull();
    expect(row['relatedEntityType']).toBe('user');
    expect(row['relatedEntityId']).toBe('42');
    expect(row['sentAt']).toBeInstanceOf(Date);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMailMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(sendArgs['from']).toBe('from@test');
    expect(sendArgs['to']).toBe('a@example.com');
    expect(sendArgs['subject']).toBe('hi');
  });

  it('marks log failed with truncated error message on send exception', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('boom'));

    const result = await sendEmail({
      to: 'b@example.com',
      subject: 's',
      html: 'h',
      text: 't',
      templateKey: 'test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('boom');
    expect(logRows).toHaveLength(1);
    expect(logRows[0]!['status']).toBe('failed');
    expect(logRows[0]!['errorMessage']).toBe('boom');
  });

  it('truncates long error messages to <=1000 chars', async () => {
    const huge = 'x'.repeat(1500);
    sendMailMock.mockRejectedValueOnce(new Error(huge));

    const result = await sendEmail({
      to: 'c@example.com',
      subject: 's',
      html: 'h',
      text: 't',
      templateKey: 'test',
    });

    expect(result.ok).toBe(false);
    const stored = String(logRows[0]!['errorMessage']);
    // 1000 chars + the trailing ellipsis character we add
    expect(stored.length).toBeLessThanOrEqual(1001);
    expect(stored.endsWith('…')).toBe(true);
  });
});
