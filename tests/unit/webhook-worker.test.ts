import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebhookDelivery, WebhookSubscription } from '@prisma/client';

// M30.7 — WebhookSubscription.id is a cuid string (was bigint).
// WebhookDelivery.id stays bigint (only the parent changed). Test
// fixtures use a cuid-shaped SUB_ID string and bigint delivery ids.
const mocks = vi.hoisted(() => ({
  subscriptions: [] as WebhookSubscription[],
  calls: {
    markDelivered: [] as bigint[],
    markFailed: [] as Array<{ id: bigint; nextRetryAt: Date }>,
    markDead: [] as Array<{ id: bigint; error: string }>,
    recordResult: [] as Array<{ id: string; status: string }>,
    disabled: [] as string[],
  },
}));

vi.mock('@/lib/webhooks/db', () => ({
  getSubscriptionById: (id: string) =>
    Promise.resolve(mocks.subscriptions.find((s) => s.id === id) ?? null),
  markDeliveryDelivered: (id: bigint, _now: Date) => {
    mocks.calls.markDelivered.push(id);
    return Promise.resolve();
  },
  markDeliveryFailed: (id: bigint, _now: Date, nextRetryAt: Date) => {
    mocks.calls.markFailed.push({ id, nextRetryAt });
    return Promise.resolve();
  },
  markDeliveryDead: (id: bigint, _now: Date, error: string) => {
    mocks.calls.markDead.push({ id, error });
    return Promise.resolve();
  },
  recordDeliveryResult: (id: string, status: string, _now: Date) => {
    mocks.calls.recordResult.push({ id, status });
    return Promise.resolve();
  },
  disableSubscription: (id: string) => {
    mocks.calls.disabled.push(id);
    return Promise.resolve();
  },
  claimDueDeliveries: () => Promise.resolve([]),
}));

import { attemptDelivery, processOneDelivery } from '@/lib/webhooks/worker';

const SUB_ID = 'sub00000000000000000001';
const DEL_PREFIX = 'del000000000000000000';
function mkSub(id: string = SUB_ID, active = true, url = 'https://example.com/wh'): WebhookSubscription {
  return {
    id,
    url,
    secret: 'a'.repeat(64),
    eventFilter: ['*'],
    active,
    createdAt: new Date('2026-01-01'),
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdBy: null,
  };
}

function mkDelivery(seq: number, subId: string = SUB_ID, attemptCount = 0): WebhookDelivery {
  return {
    id: BigInt(seq),
    subscriptionId: subId,
    eventId: BigInt(100),
    eventAction: 'repo.refresh.succeeded',
    eventTargetType: 'repository',
    eventTargetId: 'owner/repo',
    eventCreatedAt: new Date('2026-01-02'),
    payload: { ok: true },
    attemptCount,
    status: 'pending',
    lastAttemptAt: null,
    lastError: null,
    nextRetryAt: null,
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  };
}

function stubFetch(statusCode: number): typeof fetch {
  // 204/304 responses must have a null body per fetch spec; passing a
  // string body to them throws inside the runtime's Response ctor.
  const body = statusCode === 204 || statusCode === 304 ? null : '{}';
  return (async () =>
    new Response(body, {
      status: statusCode,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function stubFetchThrow(msg: string): typeof fetch {
  return (async () => {
    throw new Error(msg);
  }) as unknown as typeof fetch;
}

const NOW = new Date('2026-01-10T00:00:00Z');

beforeEach(() => {
  mocks.subscriptions.length = 0;
  mocks.calls.markDelivered.length = 0;
  mocks.calls.markFailed.length = 0;
  mocks.calls.markDead.length = 0;
  mocks.calls.recordResult.length = 0;
  mocks.calls.disabled.length = 0;
});

describe('webhook worker — attemptDelivery', () => {
  it('returns ok=true on 2xx', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetch(200));
    expect(r.ok).toBe(true);
    expect(r.statusCode).toBe(200);
  });

  it('returns ok=true on 204 (no content)', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetch(204));
    expect(r.ok).toBe(true);
  });

  it('returns ok=false on 500', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetch(500));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(500);
  });

  it('returns ok=false on 400 (bad payload — never succeed)', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetch(400));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(400);
  });

  it('returns ok=false on 401 with auth-style error', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetch(401));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it('returns ok=false on 408/429 (treated as transient)', async () => {
    expect((await attemptDelivery('u', 's'.repeat(64), '{}', {}, stubFetch(408))).statusCode).toBe(408);
    expect((await attemptDelivery('u', 's'.repeat(64), '{}', {}, stubFetch(429))).statusCode).toBe(429);
  });

  it('returns statusCode=0 + error on fetch throw', async () => {
    const r = await attemptDelivery('https://example.com', 's'.repeat(64), '{}', {}, stubFetchThrow('ECONNREFUSED'));
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(0);
    expect(r.error).toContain('ECONNREFUSED');
  });
});

describe('webhook worker — processOneDelivery', () => {
  it('marks delivered on 200', async () => {
    const sub = mkSub(SUB_ID);
    mocks.subscriptions.push(sub);
    const out = await processOneDelivery(mkDelivery(10), {
      fetchImpl: stubFetch(200),
      now: NOW,
    });
    expect(out).toBe('delivered');
    expect(mocks.calls.markDelivered).toContain(BigInt(10));
    expect(mocks.calls.markDead).toHaveLength(0);
  });

  it('marks dead (and disables sub) on 401 — bad signature is permanent', async () => {
    const sub = mkSub(SUB_ID);
    mocks.subscriptions.push(sub);
    const out = await processOneDelivery(mkDelivery(11), {
      fetchImpl: stubFetch(401),
      now: NOW,
    });
    expect(out).toBe('dead');
    expect(mocks.calls.markDead[0]?.id).toEqual(BigInt(11));
    expect(mocks.calls.disabled).toContain(SUB_ID);
  });

  it('marks failed (schedules retry) on 500 with attemptCount=0', async () => {
    const sub = mkSub(SUB_ID);
    mocks.subscriptions.push(sub);
    const out = await processOneDelivery(mkDelivery(12, SUB_ID, 0), {
      fetchImpl: stubFetch(500),
      now: NOW,
    });
    expect(out).toBe('failed');
    expect(mocks.calls.markFailed).toHaveLength(1);
    expect(mocks.calls.markFailed[0]?.id).toEqual(BigInt(12));
    // 1m after NOW
    expect(mocks.calls.markFailed[0]?.nextRetryAt.toISOString()).toBe(
      new Date(NOW.getTime() + 60_000).toISOString(),
    );
    expect(mocks.calls.markDead).toHaveLength(0);
  });

  it('marks dead when attemptCount reaches MAX_ATTEMPTS on transient failure', async () => {
    const sub = mkSub(SUB_ID);
    mocks.subscriptions.push(sub);
    // attemptCount=4 + this 500 = 5 (max)
    const out = await processOneDelivery(mkDelivery(13, SUB_ID, 4), {
      fetchImpl: stubFetch(500),
      now: NOW,
    });
    expect(out).toBe('dead');
    expect(mocks.calls.markDead).toHaveLength(1);
    expect(mocks.calls.disabled).toContain(SUB_ID);
  });

  it('marks dead (without disabling) when subscription was deleted', async () => {
    // No sub in mocks.subscriptions
    const out = await processOneDelivery(mkDelivery(14, 'sub99999999999999999999'), {
      fetchImpl: stubFetch(200),
      now: NOW,
    });
    expect(out).toBe('dead');
    expect(mocks.calls.markDead[0]?.error).toContain('subscription not found');
    expect(mocks.calls.disabled).toHaveLength(0);
  });

  it('treats inactive subscription as failed (far-future retry, no HTTP call)', async () => {
    const sub = mkSub(SUB_ID, false);
    mocks.subscriptions.push(sub);
    const fetchSpy = vi.fn();
    const out = await processOneDelivery(mkDelivery(15), {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      now: NOW,
    });
    expect(out).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.calls.markFailed[0]?.id).toEqual(BigInt(15));
    // 365 days out
    const expected = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(mocks.calls.markFailed[0]?.nextRetryAt.toISOString()).toBe(expected);
  });
});