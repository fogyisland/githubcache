import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * M32.7.3 — writeAudit fan-out must NOT use dynamic `import('@/lib/webhooks/db')`.
 *
 * Root cause of `Module is not available (weak dependency)` on prod:
 * `next.config.mjs` sets `module.parser.javascript.dynamicImportMode = 'weak'`
 * to silence a next-intl FileSystemInfo warning. Webpack applies that to
 * EVERY dynamic import in the bundle — including our lazy-load of the
 * webhooks module from `writer.ts`. In dev the module resolves fine, but
 * in production the chunk loader treats the import as optional and the
 * server chunk can't find the module id at runtime.
 *
 * The fix is to import `findMatchingSubscriptions` and `enqueueDelivery`
 * statically at the top of `writer.ts`. The module-load graph only adds
 * `@/lib/webhooks/db` (which already imports only `@/lib/db/client` and
 * type imports — no transitive heaviness), and the call site is fire-
 * and-forget so the synchronous import doesn't add latency to the audit
 * hot path.
 *
 * These tests pin the BEHAVIOR that ensures the bug stays fixed:
 *
 *   1. After `writeAudit()` resolves, `findMatchingSubscriptions` is
 *      reachable from `writer.ts` synchronously (not gated behind a
 *      dynamic import). We assert this by importing `findMatchingSubscriptions`
 *      at the top of this test file (which forces `writer.ts`'s static
 *      import graph to compile) AND by mocking the module so we can
 *      assert it was invoked.
 *
 *   2. The fan-out fires even when there are no subscriptions (no-op
 *      fast path).
 *
 *   3. A failure in fan-out does NOT propagate to the writeAudit
 *      caller — the audit write itself returns successfully.
 *
 * NOTE: the production build error happens at the webpack chunk
 * resolution layer and is invisible to vitest (which uses esbuild).
 * These tests pin the source-level invariant that prevents a
 * regression to dynamic-import.
 */

// Mock @/lib/webhooks/db BEFORE importing the module under test, so the
// Proxy in @/lib/db/client never gets touched and so we can spy on the
// fan-out functions.
vi.mock('@/lib/webhooks/db', () => ({
  findMatchingSubscriptions: vi.fn(async () => [] as Array<{ id: string; url: string }>),
  enqueueDelivery: vi.fn(async () => undefined),
}));

// Mock @/lib/db/client so writeAudit doesn't try to open a real connection.
// The create() spy echoes back whatever action was passed in so the
// downstream enqueueDelivery() call sees the same action.
const fakeCreatedAt = new Date('2026-09-15T00:00:00Z');
vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(async (args: { data: { action: string; targetType: string; targetId: string; actorUserId: bigint; metadata?: unknown; ip?: string | null } }) => ({
        id: 1n,
        action: args.data.action,
        targetType: args.data.targetType,
        targetId: args.data.targetId,
        actorUserId: args.data.actorUserId,
        metadata: args.data.metadata ?? null,
        ip: args.data.ip ?? null,
        createdAt: fakeCreatedAt,
      })),
    },
  },
}));

import { writeAudit } from '@/lib/audit/writer';
import { findMatchingSubscriptions, enqueueDelivery } from '@/lib/webhooks/db';

beforeEach(() => {
  vi.mocked(findMatchingSubscriptions).mockClear();
  vi.mocked(enqueueDelivery).mockClear();
  vi.mocked(findMatchingSubscriptions).mockResolvedValue([]);
});

describe('writeAudit fan-out (M32.7.3 — static import of @/lib/webhooks/db)', () => {
  it('does not use dynamic import for findMatchingSubscriptions (module is reachable from the writer module statically)', async () => {
    // If writer.ts reverted to `await import('@/lib/webhooks/db')`,
    // webpack's `dynamicImportMode: 'weak'` would mark it optional and
    // prod would fail with "Module is not available (weak dependency)".
    // The test below pins the static-import invariant: importing
    // findMatchingSubscriptions from this test file MUST be the same
    // module instance that writeAudit invokes. With dynamic import,
    // webpack would treat them as separate chunks and the assertion
    // would still hold at runtime — but the SOURCE-level invariant
    // ("writer.ts statically imports webhooks/db") is what we're
    // pinning, and that's enforced by the implementation, not by
    // mocking. The behavioral assertion: writeAudit calls the mocked
    // findMatchingSubscriptions (proves the module graph connects
    // without dynamic-import runtime errors).
    await writeAudit({ action: 'test.event', targetType: 'test', targetId: '1' });
    // Allow the fire-and-forget microtask to flush.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(findMatchingSubscriptions).toHaveBeenCalledTimes(1);
    expect(findMatchingSubscriptions).toHaveBeenCalledWith('test.event');
  });

  it('no-op fast path: empty subscription list does not enqueue any deliveries', async () => {
    vi.mocked(findMatchingSubscriptions).mockResolvedValue([]);
    await writeAudit({ action: 'test.empty', targetType: 'test', targetId: '1' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(findMatchingSubscriptions).toHaveBeenCalledTimes(1);
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it('enqueues one delivery per matching subscription', async () => {
    vi.mocked(findMatchingSubscriptions).mockResolvedValue([
      { id: 'sub_1', url: 'https://example.com/hook1' },
      { id: 'sub_2', url: 'https://example.com/hook2' },
    ] as never);
    await writeAudit({ action: 'test.multi', targetType: 'test', targetId: '1' });
    // Allow promise.allSettled to resolve.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(findMatchingSubscriptions).toHaveBeenCalledTimes(1);
    expect(enqueueDelivery).toHaveBeenCalledTimes(2);
    expect(enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_1',
        event: expect.objectContaining({ action: 'test.multi' }),
      }),
    );
    expect(enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub_2',
        event: expect.objectContaining({ action: 'test.multi' }),
      }),
    );
  });

  it('writeAudit returns even when fan-out throws', async () => {
    vi.mocked(findMatchingSubscriptions).mockRejectedValue(new Error('fan-out exploded'));
    // Should not throw — fan-out is fire-and-forget.
    const row = await writeAudit({ action: 'test.explode', targetType: 'test', targetId: '1' });
    expect(row.action).toBe('test.explode');
    // Flush microtask so the .catch handler has a chance to run.
    await new Promise<void>((resolve) => setImmediate(resolve));
    // findMatchingSubscriptions was called (rejection surfaces in the
    // fire-and-forget .catch handler, which writer.ts:38 logs).
    expect(findMatchingSubscriptions).toHaveBeenCalledTimes(1);
  });
});

describe('writer.ts source-level invariant (M32.7.3 — static import only)', () => {
  /**
   * The production bug (`Module is not available (weak dependency)`) is
   * invisible to vitest because vitest uses esbuild and skips webpack's
   * chunk-resolution layer. The next.config.mjs `dynamicImportMode: 'weak'`
   * only fires in `next build` output.
   *
   * Pin the source-level invariant: writer.ts MUST NOT use a dynamic
   * `import('@/lib/webhooks/db')` — it has to import the module
   * statically at the top so webpack treats it as a required dependency.
   * This test fails today (RED) and will pass once the writer is fixed
   * to a static import (GREEN).
   */
  it('does not dynamically import @/lib/webhooks/db', () => {
    const writerPath = resolve(__dirname, '../../src/lib/audit/writer.ts');
    const source = readFileSync(writerPath, 'utf8');
    // Strip comment lines so the regex doesn't false-match on JSDoc that
    // describes the old (now-removed) lazy import.
    const codeLines = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    // Match `import('...')` / `await import('...')` referencing webhooks/db.
    const dynamicImportRe = /import\s*\(\s*['"`][^'"`]*webhooks\/db[^'"`]*['"`]\s*\)/;
    expect(codeLines).not.toMatch(dynamicImportRe);
  });
});