import { prisma } from '@/lib/db/client';
import type { EmailLog, EmailLogStatus, Prisma } from '@prisma/client';

const ERROR_MESSAGE_MAX = 1000;

/**
 * M25 — CRUD helpers for the `email_log` append-only send log.
 *
 * Lifecycle: every send starts as `queued` (created by `createEmailLog`),
 * then advances to `sent` (after nodemailer confirms) or `failed`
 * (after the transport raises). The log row is the audit trail of who
 * we tried to reach, with what template, and what happened.
 */

export interface CreateEmailLogInput {
  recipient: string;
  subject: string;
  templateKey: string;
  relatedEntity?: { type: string; id: string };
}

export async function createEmailLog(input: CreateEmailLogInput): Promise<EmailLog> {
  return prisma.emailLog.create({
    data: {
      recipient: input.recipient,
      subject: input.subject,
      templateKey: input.templateKey,
      status: 'queued',
      ...(input.relatedEntity
        ? {
            relatedEntityType: input.relatedEntity.type,
            relatedEntityId: input.relatedEntity.id,
          }
        : {}),
    },
  });
}

export async function recordEmailSent(id: bigint, _messageId: string): Promise<void> {
  await prisma.emailLog.update({
    where: { id },
    data: {
      status: 'sent',
      sentAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function recordEmailFailed(id: bigint, errorMessage: string): Promise<void> {
  const truncated =
    errorMessage.length > ERROR_MESSAGE_MAX
      ? `${errorMessage.slice(0, ERROR_MESSAGE_MAX)}…`
      : errorMessage;
  await prisma.emailLog.update({
    where: { id },
    data: {
      status: 'failed',
      errorMessage: truncated,
    },
  });
}

export interface ListEmailLogOptions {
  skip: number;
  take: number;
  status?: EmailLogStatus;
  templateKey?: string;
}

/**
 * List email log rows, newest first, with optional filters. Returns
 * the page + the total matching count so callers can render pagination.
 */
export async function listEmailLog(
  opts: ListEmailLogOptions,
): Promise<{ rows: EmailLog[]; total: number }> {
  const where: Prisma.EmailLogWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.templateKey) where.templateKey = opts.templateKey;

  const [rows, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.emailLog.count({ where }),
  ]);
  return { rows, total };
}
