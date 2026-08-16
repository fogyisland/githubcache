import { prisma } from '@/lib/db/client';
import type { AuditLog, Prisma } from '@prisma/client';

export interface WriteAuditArgs {
  actorUserId?: bigint;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: unknown;
  ip?: string;
}

export async function writeAudit(args: WriteAuditArgs): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      ...(args.actorUserId !== undefined ? { actorUserId: args.actorUserId } : {}),
      ...(args.metadata !== undefined
        ? { metadata: args.metadata as Prisma.InputJsonValue }
        : {}),
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
    },
  });
}
