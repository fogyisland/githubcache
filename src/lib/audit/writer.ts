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
  const row = await prisma.auditLog.create({
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

  // M14.6 — fan out the new event to every active webhook subscription
  // whose eventFilter matches. Fire-and-forget: the audit-write hot path
  // MUST NOT block on fan-out or take a failure here as an audit
  // failure. Each enqueue is wrapped so one bad subscription doesn't
  // poison the rest.
  void fanOutAuditEvent(row).catch((e) => {
    console.error('fanOutAuditEvent failed', e);
  });

  return row;
}

/**
 * Find every active subscription matching the audit action and enqueue
 * a delivery row for each. Imported lazily to keep the audit writer's
 * module-load graph narrow and to avoid pulling the entire webhook
 * module into every code path that writes audit rows.
 */
async function fanOutAuditEvent(row: AuditLog): Promise<void> {
  const { findMatchingSubscriptions, enqueueDelivery } = await import('@/lib/webhooks/db');
  const subs = await findMatchingSubscriptions(row.action);
  if (subs.length === 0) return;
  // Enqueue in parallel — each insert is independent. A failure on one
  // subscription (e.g., FK violation) must not block the others.
  await Promise.allSettled(
    subs.map((sub) =>
      enqueueDelivery({
        subscriptionId: sub.id,
        event: {
          id: row.id,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          createdAt: row.createdAt,
          ...(row.metadata !== null && row.metadata !== undefined
            ? { metadata: row.metadata }
            : {}),
          ...(row.actorUserId !== null && row.actorUserId !== undefined
            ? { actorUserId: row.actorUserId }
            : { actorUserId: null }),
          ...(row.ip !== null && row.ip !== undefined ? { ip: row.ip } : { ip: null }),
        },
      }),
    ),
  );
}