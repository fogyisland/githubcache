import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebhookDelivery, WebhookSubscription } from '@prisma/client';

// M30.7+ — WebhookSubscription.id AND WebhookDelivery.id are both cuid
// strings (the deliveries table had the same drift as the subscriptions
// table; both id and eventId were varchar in DB but BigInt in schema).
// Test fixtures use cuid-shaped SUB_ID + DEL_ID strings.
const mocks = vi.hoisted(() => ({
  subscriptions: [] as WebhookSubscription[],
  calls: {
    markDelivered: [] as string[],
    markFailed: [] as Array<{ id: string; nextRetryAt: Date }>,
    markDead: [] as Array<{ id: string; error: string }>,
    recordResult: [] as Array<{ id: string; status: string }>,
    disabled: [] as string[],
  },
}));

vi.mock('@/lib/webhooks/db', () => ({
  getSubscriptionById: (id: string) =>
    Promise.resolve(mocks.subscriptions.find((s) => s.id === id) ?? null),
  markDeliveryDelivered: (id: string, _now: Date) => {
    mocks.calls.markDelivered.push(id);
    return Promise.resolve();
  },
  markDeliveryFailed: (id: string, _now: Date, nextRetryAt: Date) => {
    mocks.calls.markFailed.push({ id, nextRetryAt });
    return Promise.resolve();
  },
  markDeliveryDead: (id: string, _now: Date, error: string) => {
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
function mkDeliveryId(seq: number): string {
  // Pad sequence to 19 chars to make a cuid-shaped string (mirrors what
  // MySQL stores when the column is varchar(191)).
  return DEL_PREFIX + String(seq).padStart(2, '0');
}
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
    id: mkDeliveryId(seq),
    subscriptionId: subId,
    eventId: 'evt00000000000000000100',
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
    expect(mocks.calls.markDelivered).toContain(mkDeliveryId(10));
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
    expect(mocks.calls.markDead[0]?.id).toEqual(mkDeliveryId(11));
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
    expect(mocks.calls.markFailed[0]?.id).toEqual(mkDeliveryId(12));
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
    expect(mocks.calls.markFailed[0]?.id).toEqual(mkDeliveryId(15));
    // 365 days out
    const expected = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(mocks.calls.markFailed[0]?.nextRetryAt.toISOString()).toBe(expected);
  });
});