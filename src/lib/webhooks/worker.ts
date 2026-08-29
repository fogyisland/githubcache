import { logger } from '@/lib/logger';
import { signWebhookPayload } from './signer';
import {
  claimDueDeliveries,
  getSubscriptionById,
  markDeliveryDead,
  markDeliveryDelivered,
  markDeliveryFailed,
  recordDeliveryResult,
  disableSubscription,
} from './db';
import { nextRetryMs, shouldDeadLetter } from './retry';
import type { WebhookDelivery } from '@prisma/client';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Result of a single delivery attempt. Kept private to the worker so
 * callers don't depend on the internals.
 */
interface AttemptResult {
  ok: boolean;
  statusCode: number;
  error?: string;
}

/**
 * Perform one HTTP POST for a delivery. Sends the payload as JSON with
 * the GitHub-compatible `X-Hub-Signature-256` header so receivers can
 * reuse existing verification code. Times out after 10s to keep the
 * worker loop responsive.
 *
 * Exported separately so tests can inject a stubbed `fetch`.
 */
export async function attemptDelivery(
  url: string,
  secret: string,
  payloadJson: string,
  eventHeaders: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<AttemptResult> {
  const signature = signWebhookPayload(secret, payloadJson);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'user-agent': 'githubcache-webhook/1.0',
        ...eventHeaders,
      },
      body: payloadJson,
      signal: ctrl.signal,
    });
    const statusCode = res.status;
    if (statusCode >= 200 && statusCode < 300) {
      return { ok: true, statusCode };
    }
    // 4xx is "client error — bad payload or signature". Mark dead
    // immediately rather than burning 5 retries on something that
    // will never succeed. 5xx is "server error — try again".
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429) {
      return { ok: false, statusCode, error: `HTTP ${statusCode}` };
    }
    return { ok: false, statusCode, error: `HTTP ${statusCode}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, statusCode: 0, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Process a single delivery row. Looks up the subscription, signs,
 * POSTs, and updates the row to its terminal/intermediate state.
 *
 * Returns the resulting status string for logging. Exported so tests
 * can call it directly without spinning up the worker loop.
 */
export async function processOneDelivery(
  delivery: WebhookDelivery,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<'delivered' | 'failed' | 'dead'> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();

  const sub = await getSubscriptionById(delivery.subscriptionId);
  if (!sub) {
    // Subscription was deleted between enqueue and dispatch. Mark
    // the delivery dead so it's not retried indefinitely.
    await markDeliveryDead(delivery.id, now, 'subscription not found');
    return 'dead';
  }
  if (!sub.active) {
    // Subscription got disabled (operator or auto-dead). Skip — leave
    // the row as-is so the admin can see what would have been sent.
    // Actually re-stamp nextRetryAt to far future so we don't pick it
    // up again — the operator will retry manually if needed.
    await markDeliveryFailed(delivery.id, now, new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), 'subscription inactive');
    return 'failed';
  }

  const payloadJson = JSON.stringify({
    id: delivery.eventId.toString(),
    action: delivery.eventAction,
    targetType: delivery.eventTargetType,
    targetId: delivery.eventTargetId,
    createdAt: delivery.eventCreatedAt.toISOString(),
    deliveryId: delivery.id.toString(),
    payload: delivery.payload,
  });
  const result = await attemptDelivery(
    sub.url,
    sub.secret,
    payloadJson,
    { 'x-githubcache-event': delivery.eventAction },
    fetchImpl,
  );

  if (result.ok) {
    await markDeliveryDelivered(delivery.id, now);
    await recordDeliveryResult(sub.id, 'delivered', now);
    logger.info(
      {
        deliveryId: delivery.id.toString(),
        subscriptionId: sub.id.toString(),
        statusCode: result.statusCode,
        attemptCount: delivery.attemptCount + 1,
      },
      'webhook delivered',
    );
    return 'delivered';
  }

  // Failure path. Compute new attempt count (post-increment).
  const newAttemptCount = delivery.attemptCount + 1;
  const errMsg = result.error ?? `HTTP ${result.statusCode}`;

  if (shouldDeadLetter(newAttemptCount) || result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 408 && result.statusCode !== 429) {
    // Dead-letter: either max attempts reached, or a permanent client
    // error (4xx that isn't timeout/rate-limit). Auto-disable the
    // subscription so the admin UI surfaces the failure clearly.
    await markDeliveryDead(delivery.id, now, errMsg);
    await recordDeliveryResult(sub.id, 'dead', now);
    await disableSubscription(sub.id);
    logger.warn(
      {
        deliveryId: delivery.id.toString(),
        subscriptionId: sub.id.toString(),
        attemptCount: newAttemptCount,
        statusCode: result.statusCode,
        error: errMsg,
      },
      'webhook dead-lettered; subscription auto-disabled',
    );
    return 'dead';
  }

  // Transient failure — schedule next retry per the backoff schedule.
  const ms = nextRetryMs(newAttemptCount);
  if (ms === null) {
    // Shouldn't happen because shouldDeadLetter gated above, but
    // defensive: escalate to dead if we can't compute a retry.
    await markDeliveryDead(delivery.id, now, errMsg);
    await recordDeliveryResult(sub.id, 'dead', now);
    await disableSubscription(sub.id);
    return 'dead';
  }
  const nextRetryAt = new Date(now.getTime() + ms);
  await markDeliveryFailed(delivery.id, now, nextRetryAt, errMsg);
  await recordDeliveryResult(sub.id, 'failed', now);
  logger.warn(
    {
      deliveryId: delivery.id.toString(),
      subscriptionId: sub.id.toString(),
      attemptCount: newAttemptCount,
      statusCode: result.statusCode,
      nextRetryAt: nextRetryAt.toISOString(),
      error: errMsg,
    },
    'webhook delivery failed; will retry',
  );
  return 'failed';
}

export interface WorkerTickResult {
  processed: number;
  delivered: number;
  failed: number;
  dead: number;
}

/**
 * One worker tick: claim up to `batchSize` due deliveries and process
 * them serially. Returns a count summary for the caller (the scheduler
 * tick in src/server.ts).
 */
export async function runWorkerTick(
  batchSize = 25,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<WorkerTickResult> {
  const now = opts.now ?? new Date();
  const due = await claimDueDeliveries({ batchSize, now });
  const summary: WorkerTickResult = { processed: 0, delivered: 0, failed: 0, dead: 0 };
  for (const delivery of due) {
    const status = await processOneDelivery(delivery, opts);
    summary.processed += 1;
    if (status === 'delivered') summary.delivered += 1;
    else if (status === 'failed') summary.failed += 1;
    else summary.dead += 1;
  }
  return summary;
}