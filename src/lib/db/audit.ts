import type { AuditLog, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export interface AuditQuery {
  action?: string;
  actorUserId?: bigint;
  targetType?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface AuditPage {
  rows: AuditLog[];
  total: number;
}

export function buildAuditWhere(q: Pick<AuditQuery, 'action' | 'actorUserId' | 'targetType' | 'from' | 'to'>): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (q.action) where.action = q.action;
  if (q.actorUserId !== undefined) where.actorUserId = q.actorUserId;
  if (q.targetType) where.targetType = q.targetType;
  if (q.from || q.to) {
    where.createdAt = {
      ...(q.from ? { gte: q.from } : {}),
      ...(q.to ? { lt: q.to } : {}),
    };
  }
  return where;
}

export async function queryAuditLog(q: AuditQuery): Promise<AuditPage> {
  const where = buildAuditWhere(q);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      skip: q.offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Look up actor users' emails by id. Returns a Map keyed by id; missing
 * entries (deleted users) map to null. Used to render the audit table's
 * "Actor" column without an N+1 — one findMany for the whole result set.
 */
export async function getActorEmails(userIds: bigint[]): Promise<Map<bigint, string | null>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.email]));
}
