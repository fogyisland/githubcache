import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db/client';

// Mock next/headers BEFORE the action module loads.
const xffState = { current: '203.0.113.50' as string | null };
vi.mock('next/headers', () => ({
  headers: () => ({
    get(name: string): string | null {
      if (name.toLowerCase() !== 'x-forwarded-for') return null;
      return xffState.current;
    },
  }),
}));

// Mock next/cache revalidatePath — no-op in tests.
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

// Mock the lookup helper so tests do not hit the real GitHub API.
const lookupRepoMock = vi.fn();
vi.mock('@/lib/cache/lookup', () => ({
  lookupRepo: (...args: unknown[]) => lookupRepoMock(...args),
}));

// Now safe to import the action.
import { lookupAction } from '@/app/_actions/lookup';

const TEST_IP_PREFIX = '203.0.113.';

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.ipRateLimitBucket.deleteMany({
    where: { ip: { startsWith: TEST_IP_PREFIX } },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  xffState.current = '203.0.113.50';
  lookupRepoMock.mockReset();
  lookupRepoMock.mockResolvedValue({
    canonical: 'octocat/hello-world',
    original: 'octocat/hello-world',
    found: true,
    metadata: { full_name: 'octocat/hello-world', stargazers_count: 80 },
    last_fetched_at: new Date(),
    fetch_status: 'ok',
    stale: false,
  });
  await prisma.ipRateLimitBucket.deleteMany({
    where: { ip: { startsWith: TEST_IP_PREFIX } },
  });
});

function formDataFor(owner: string, name: string): FormData {
  const fd = new FormData();
  fd.set('owner', owner);
  fd.set('name', name);
  return fd;
}

const idleState = { status: 'idle' as const };

describe('lookupAction (public form)', () => {
  describe('input validation', () => {
    it('rejects malformed owner (spaces, special chars)', async () => {
      const state = await lookupAction(idleState, formDataFor('bad owner!', 'repo'));
      expect(state.status).toBe('invalid');
      expect(state.message).toMatch(/owner/);
    });

    it('rejects malformed name (spaces, special chars)', async () => {
      const state = await lookupAction(idleState, formDataFor('octocat', 'bad name!'));
      expect(state.status).toBe('invalid');
      expect(state.message).toMatch(/name/);
    });

    it('rejects empty owner', async () => {
      const state = await lookupAction(idleState, formDataFor('', 'repo'));
      expect(state.status).toBe('invalid');
    });

    it('rejects empty name', async () => {
      const state = await lookupAction(idleState, formDataFor('octocat', ''));
      expect(state.status).toBe('invalid');
    });

    it('rejects owner too long', async () => {
      const state = await lookupAction(
        idleState,
        formDataFor('a'.repeat(101), 'repo'),
      );
      expect(state.status).toBe('invalid');
    });
  });

  describe('happy path', () => {
    it('returns ok with the result for valid input', async () => {
      const state = await lookupAction(idleState, formDataFor('octocat', 'hello-world'));
      expect(state.status).toBe('ok');
      expect(state.result?.fetch_status).toBe('ok');
      expect(lookupRepoMock).toHaveBeenCalledWith('octocat', 'hello-world');
    });
  });

  describe('per-IP rate limit', () => {
    it('rate-limits after exceeding the configured limit', async () => {
      xffState.current = '203.0.113.99';

      const { env } = await import('@/lib/config/env');
      const original = env.PUBLIC_LOOKUP_RATE_PER_MIN;
      (env as { PUBLIC_LOOKUP_RATE_PER_MIN: number }).PUBLIC_LOOKUP_RATE_PER_MIN = 2;
      try {
        const r1 = await lookupAction(idleState, formDataFor('octocat', 'hello-world'));
        const r2 = await lookupAction(idleState, formDataFor('octocat', 'hello-world'));
        const r3 = await lookupAction(idleState, formDataFor('octocat', 'hello-world'));
        expect(r1.status).not.toBe('rate_limited');
        expect(r2.status).not.toBe('rate_limited');
        expect(r3.status).toBe('rate_limited');
        expect(r3.retryAfterSeconds).toBeGreaterThan(0);
      } finally {
        (env as { PUBLIC_LOOKUP_RATE_PER_MIN: number }).PUBLIC_LOOKUP_RATE_PER_MIN = original;
      }
    });

    it('counts different IPs independently', async () => {
      xffState.current = '203.0.113.111';
      const r1 = await lookupAction(idleState, formDataFor('octocat', 'a'));
      xffState.current = '203.0.113.112';
      const r2 = await lookupAction(idleState, formDataFor('octocat', 'a'));
      expect(r1.status).not.toBe('rate_limited');
      expect(r2.status).not.toBe('rate_limited');
    });
  });

  describe('error handling', () => {
    it('returns error status when lookupRepo throws', async () => {
      lookupRepoMock.mockRejectedValueOnce(new Error('boom'));
      const state = await lookupAction(idleState, formDataFor('octocat', 'a'));
      expect(state.status).toBe('error');
      expect(state.message).toMatch(/boom/);
    });

    it('falls back to "unknown" IP when no x-forwarded-for is set', async () => {
      xffState.current = null;
      const state = await lookupAction(idleState, formDataFor('octocat', 'a'));
      expect(state.status).toBe('ok');
      // lookupRepo was called with the right args regardless of IP source.
      expect(lookupRepoMock).toHaveBeenCalledWith('octocat', 'a');
    });
  });
});
