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

// Mock next-intl/server — the action calls getTranslations inside the
// Vitest runtime, which lacks the Next.js server context that
// next-intl requires. Mirrors the M13 admin-shell test mock pattern.
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'home.lookup.errors': {
        ownerRequired: 'owner is required',
        ownerTooLong: 'owner too long',
        ownerFormat: 'invalid owner format',
        ownerInvalid: 'invalid owner',
        nameRequired: 'name is required',
        nameTooLong: 'name too long',
        nameFormat: 'invalid name format',
        nameInvalid: 'invalid name',
        rateLimited: 'Too many requests — try again in {seconds}s',
        generic: 'Lookup failed',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
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

      // The env is read-only via a Proxy (src/lib/config/env.ts uses
      // a Proxy to defer zod parse), so we can't mutate
      // PUBLIC_LOOKUP_RATE_PER_MIN in-process. Instead, pre-seed the
      // IP bucket at the limit so the next atomic increment trips the
      // ceiling on the very first lookupAction call.
      const limit = Number(process.env.PUBLIC_LOOKUP_RATE_PER_MIN ?? '30');
      const now = new Date();
      const windowStart = new Date(
        Math.floor(now.getTime() / 60_000) * 60_000,
      );
      await prisma.ipRateLimitBucket.deleteMany({ where: { ip: '203.0.113.99' } });
      await prisma.$executeRaw`
        INSERT INTO ip_rate_limit_buckets
          (ip, window_start, count, created_at, updated_at)
        VALUES
          ('203.0.113.99', ${windowStart}, ${limit}, ${now}, ${now})
      `;

      const r = await lookupAction(idleState, formDataFor('octocat', 'hello-world'));
      expect(r.status).toBe('rate_limited');
      expect(r.retryAfterSeconds).toBeGreaterThan(0);
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
      // M13.9 changed the error path to surface a translated generic message
      // (lookup.ts:111) instead of the raw error — intentional, so we don't
      // leak internal details to public form users.
      expect(state.message).toMatch(/failed|error/i);
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
