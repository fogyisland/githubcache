import { prisma } from '@/lib/db/client';
import type { WebhookDelivery, WebhookSubscription } from '@prisma/client';

/**
 * Filters a candidate audit event against a subscription's `eventFilter`.
 *
 * Filter shape: JSON array of action strings, OR the single-element
 * `["*"]` for firehose mode. Anything else (empty array, malformed JSON,
 * non-string elements) yields no match — fail closed.
 */
export function matchesFilter(eventFilter: unknown, action: string): boolean {
  if (!Array.isArray(eventFilter)) return false;
  if (eventFilter.length === 0) return false;
  if (eventFilter.some((e) => typeof e !== 'string')) return false;
  if (eventFilter.includes('*')) return true;
  return eventFilter.includes(action);
}

/**
 * Create a new subscription. Caller supplies the secret (admin-generated
 * or our generated value) and we persist it raw — needed for HMAC
 * signing at delivery time. The admin must surface the secret exactly
 * once before discarding; we never show it again.
 */
export async function createSubscription(opts: {
  url: string;
  secret: string;
  eventFilter: string[];
  createdBy?: bigint;
}): Promise<WebhookSubscription> {
  return prisma.webhookSubscription.create({
    data: {
      url: opts.url,
      secret: opts.secret,
      eventFilter: opts.eventFilter,
      ...(opts.createdBy !== undefined ? { createdBy: opts.createdBy } : {}),
    },
  });
}

/**
 * List subscriptions newest first. Paged result so the admin list page
 * can paginate like other admin list pages (M14.2 convention:
 * `{rows, total}`).
 */
export async function listAllSubscriptions(opts: {
  skip: number;
  take: number;
}): Promise<{ rows: WebhookSubscription[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.webhookSubscription.count(),
  ]);
  return { rows, total };
}

export function getSubscriptionById(id: bigint): Promise<WebhookSubscription | null> {
  return prisma.webhookSubscription.findUnique({ where: { id } });
}

/** Rotate the signing secret on an existing subscription. Caller
 *  surfaces the new plaintext once before discarding. */
export async function rotateSubscriptionSecret(
  id: bigint,
  newSecret: string,
): Promise<WebhookSubscription> {
  return prisma.webhookSubscription.update({
    where: { id },
    data: { secret: newSecret },
  });
}

/** Disable a subscription without deleting its delivery history. */
export async function disableSubscription(id: bigint): Promise<WebhookSubscription> {
  return prisma.webhookSubscription.update({
    where: { id },
    data: { active: false },
  });
}

/** Re-arm a subscription after an operator has investigated failures.
 *  Resets `active=true` and clears the `lastDeliveryStatus` so the
 *  admin UI stops shouting. Delivery history is preserved. */
export async function reArmSubscription(id: bigint): Promise<WebhookSubscription> {
  return prisma.webhookSubscription.update({
    where: { id },
    data: { active: true, lastDeliveryStatus: null },
  });
}

/**
 * Enqueue a delivery for one (subscription, event) pair. Called by the
 * audit hook — fire-and-forget so the audit-write hot path doesn't block
 * on fan-out. Captures a snapshot of the audit row into `payload` so
 * retries can replay without re-reading the audit log (which may be
 * pruned by retention policy).
 */
export async function enqueueDelivery(opts: {
  subscriptionId: bigint;
  event: {
    id: bigint;
    action: string;
    targetType: string;
    targetId: string;
    createdAt: Date;
    metadata?: unknown;
    actorUserId?: bigint | null;
    ip?: string | null;
  };
}): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.create({
    data: {
      subscriptionId: opts.subscriptionId,
      eventId: opts.event.id,
      eventAction: opts.event.action,
      eventTargetType: opts.event.targetType,
      eventTargetId: opts.event.targetId,
      eventCreatedAt: opts.event.createdAt,
      payload: opts.event as object,
      // nextRetryAt=null means "ready immediately"; the worker will pick
      // it up on the next tick. Set by the worker on failed attempts.
      nextRetryAt: new Date(),
    },
  });
}

/**
 * Pick up to `batchSize` pending deliveries that are due for delivery
 * (nextRetryAt <= now). The worker processes them serially per row.
 * Multi-replica note: rows stay 'pending' while in flight, so two
 * workers could grab the same row in the read-then-write window.
 * Acceptable because each worker makes an idempotent HTTP call —
 * duplicates are safe. For stricter once-only semantics, add a
 * `lockedBy/lockedUntil` claim column (out of scope for M14.6).
 */
export async function claimDueDeliveries(opts: {
  batchSize: number;
  now: Date;
}): Promise<WebhookDelivery[]> {
  return prisma.webhookDelivery.findMany({
    where: {
      status: 'pending',
      nextRetryAt: { lte: opts.now },
    },
    orderBy: { nextRetryAt: 'asc' },
    take: opts.batchSize,
  });
}

/** Mark a delivery as successfully delivered (terminal state). */
export async function markDeliveryDelivered(
  id: bigint,
  now: Date,
): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'delivered',
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      nextRetryAt: null,
      lastError: null,
    },
  });
}

/**
 * Mark a delivery as transiently failed (will retry). Increments
 * `attemptCount` and schedules `nextRetryAt` per the supplied backoff.
 * The worker decides whether to escalate to `dead` based on
 * `attemptCount >= MAX_ATTEMPTS`.
 */
export async function markDeliveryFailed(
  id: bigint,
  now: Date,
  nextRetryAt: Date,
  error: string,
): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'failed',
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      nextRetryAt,
      lastError: error.slice(0, 1000),
    },
  });
}

/** Terminal state — no more retries. Subscription is auto-disabled by
 *  the caller so the admin UI makes the failure visible. */
export async function markDeliveryDead(
  id: bigint,
  now: Date,
  error: string,
): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'dead',
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      nextRetryAt: null,
      lastError: error.slice(0, 1000),
    },
  });
}

/** List recent deliveries for one subscription — admin detail page. */
export async function listDeliveriesForSubscription(
  subscriptionId: bigint,
  limit: number,
): Promise<WebhookDelivery[]> {
  return prisma.webhookDelivery.findMany({
    where: { subscriptionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Manual retry from the admin UI — resets a `dead` or `failed` delivery
 * back to `pending` with `nextRetryAt=now`. Does NOT touch the
 * subscription's `active` flag — operators may want to retry without
 * re-arming the whole subscription.
 */
export async function retryDelivery(id: bigint, now: Date): Promise<WebhookDelivery> {
  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: 'pending',
      nextRetryAt: now,
      lastError: null,
    },
  });
}

/**
 * Find every active subscription whose eventFilter matches the action.
 * Used by the audit-write hook to fan out a new event.
 */
export async function findMatchingSubscriptions(
  action: string,
): Promise<WebhookSubscription[]> {
  const all = await prisma.webhookSubscription.findMany({
    where: { active: true },
  });
  return all.filter((s) => matchesFilter(s.eventFilter, action));
}

/**
 * Touch a subscription's `lastDeliveryAt` + `lastDeliveryStatus` after
 * each delivery attempt so the admin list page shows fresh status.
 */
export async function recordDeliveryResult(
  id: bigint,
  status: 'delivered' | 'failed' | 'dead',
  now: Date,
): Promise<WebhookSubscription> {
  return prisma.webhookSubscription.update({
    where: { id },
    data: {
      lastDeliveryAt: now,
      lastDeliveryStatus: status,
    },
  });
}