import { prisma } from '@/lib/db/client';
// M32.7.3 — static import (was previously a lazy-loaded import() of
// the webhooks module inside fanOutAuditEvent). Root cause: webpack's
// dynamicImportMode=weak (set in next.config.mjs to silence a
// next-intl FileSystemInfo warning) marks every dynamic import as an
// optional chunk; in production the server bundle's lazy import of the
// webhooks module couldn't be resolved and the audit fan-out crashed
// with "Module is not available (weak dependency)" at every audit
// hook. Switching to a static import keeps the audit hot path unchanged
// (the webhooks module only adds prisma + type imports) and removes the
// webpack weak-dependency surface. See
// tests/unit/audit-writer-fanout.test.ts for the source-level invariant
// that pins this contract.
import { findMatchingSubscriptions, enqueueDelivery } from '@/lib/webhooks/db';
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
  // M28.bug21 — audit_log.actor_user_id is NOT NULL. Default to 0
  // (sentinel for "actor unknown") when caller doesn't supply one.
  // The DB column default would do this too, but Prisma's typed client
  // requires the field to be present in the create input.
  const actorUserId = args.actorUserId ?? 0n;
  const row = await prisma.auditLog.create({
    data: {
      actorUserId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
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
 * a delivery row for each.
 *
 * M32.7.3 — function body uses statically-imported findMatchingSubscriptions
 * and enqueueDelivery (see top-of-file import). The previous lazy
 * `await import('@/lib/webhooks/db')` was killed by webpack's
 * `dynamicImportMode: 'weak'` (set in next.config.mjs to silence a
 * next-intl FileSystemInfo warning) — production chunk loader treated
 * the import as optional and the server chunk couldn't find the module
 * id at runtime.
 */
async function fanOutAuditEvent(row: AuditLog): Promise<void> {
  const subs = await findMatchingSubscriptions(row.action);
  if (subs.length === 0) return;
  // Enqueue in parallel — each insert is independent. A failure on one
  // subscription (e.g., FK violation) must not block the others.
  await Promise.allSettled(
    subs.map((sub) =>
      enqueueDelivery({
        subscriptionId: sub.id,
        event: {
          id: row.id.toString(),
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