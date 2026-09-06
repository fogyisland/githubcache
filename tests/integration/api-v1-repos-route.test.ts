import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { GET } from '@/app/api/v1/repos/[owner]/[name]/route';
import { prisma } from '@/lib/db/client';
import { createTestRepo } from './helpers/repos';

/**
 * M26.x — /api/v1/repos/[owner]/[name] is now authenticated.
 *
 * Tests cover:
 *   - 401 when X-API-Key is missing
 *   - 403 when the key doesn't exist / is revoked
 *   - 200 on cache hit (with a valid active key)
 *   - 404 for fetch_status=not_found
 *   - 429 when the per-key hourly bucket is exhausted (env-tunable)
 *   - Retry-After + X-RateLimit-* headers on 429
 *
 * We use PUBLIC_REPO_RATE_PER_HOUR=3 (env override) for the rate-limit
 * tests so we don't have to push 50001 requests.
 */

const TEST_KEY_PREFIX = 'v1repos-route-int';
let operatorId: bigint;
let activeKeyPlain: string;
let activeKeyId: bigint;
let revokedKeyPlain: string;

async function makeKey(status: 'active' | 'revoked'): Promise<{ plain: string; id: bigint }> {
  const plain = `ghc_test_${randomBytes(16).toString('hex')}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  const row = await prisma.apiKey.create({
    data: {
      userId: operatorId,
      name: `${TEST_KEY_PREFIX}-${status}-${Date.now()}-${Math.random()}`,
      keyPrefix: 'ghc_test_',
      keyHash: hash,
      status,
    },
  });
  return { plain, id: row.id };
}

function authedReq(url: string, plain: string, ip = '203.0.113.1'): Request {
  return new Request(url, {
    headers: { 'x-api-key': plain, 'x-forwarded-for': ip },
  });
}

beforeEach(async () => {
  // refresh_jobs has FK to repositories — delete them first.
  await prisma.refreshJob.deleteMany({});
  await prisma.repository.deleteMany({});
  await prisma.ipRateLimitBucket.deleteMany({});
  // Clear per-key hourly buckets between tests so the rate limit is fresh.
  await prisma.rateLimitBucket.deleteMany({
    where: { apiKey: { name: { startsWith: TEST_KEY_PREFIX } } },
  });
  // Provision a fresh operator + active key.
  await prisma.apiKey.deleteMany({ where: { name: { startsWith: TEST_KEY_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_KEY_PREFIX } } });
  const op = await prisma.user.create({
    data: {
      email: `${TEST_KEY_PREFIX}-op-${Date.now()}@example.test`,
      role: 'operator',
      status: 'active',
      passwordHash: 'placeholder',
      signupSource: 'self',
    },
  });
  operatorId = op.id;
  const active = await makeKey('active');
  activeKeyPlain = active.plain;
  activeKeyId = active.id;
  const revoked = await makeKey('revoked');
  revokedKeyPlain = revoked.plain;
});

describe('GET /api/v1/repos/[owner]/[name] (M26.x authenticated)', () => {
  it('returns 401 when X-API-Key is missing', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = new Request('http://localhost/api/v1/repos/octocat/Hello-World');
    const res = await GET(req, { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(401);
  });

  it('returns 403 for an unknown / invalid key', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = authedReq(
      'http://localhost/api/v1/repos/octocat/Hello-World',
      'ghc_test_definitely_not_a_real_key',
    );
    const res = await GET(req, { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(403);
  });

  it('returns 403 for a revoked key', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = authedReq(
      'http://localhost/api/v1/repos/octocat/Hello-World',
      revokedKeyPlain,
    );
    const res = await GET(req, { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(403);
  });

  it('returns 200 with repository shape for a cached repo on valid key', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = authedReq(
      'http://localhost/api/v1/repos/octocat/Hello-World',
      activeKeyPlain,
    );
    const res = await GET(req, { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fetch_status).toBe('ok');
    expect(body.fetched_at).toBeTruthy();
    // RepoCoreData shape — NO `owner` field; owner lives only in the URL path.
    expect(body.repository).not.toHaveProperty('owner');
    expect(body.repository.name).toBe('Hello-World');
    expect(body.repository.stars).toBe(123);
    expect(body.repository.forks).toBe(900);
    expect(body.repository.watchers).toBe(80);
    expect(body.repository.language).toBe('TypeScript');
    expect(body.repository.defaultBranch).toBe('main');
    expect(body.repository.license).toBe('MIT');
    expect(body.repository.createdAt).toBe('2020-01-01T00:00:00Z');
    expect(body.repository.archived).toBe(false);
  });

  it('returns 404 for repo with fetch_status=not_found', async () => {
    await createTestRepo({ owner: 'ghost', name: 'nope', status: 'not_found' });
    const req = authedReq(
      'http://localhost/api/v1/repos/ghost/nope',
      activeKeyPlain,
      '203.0.113.2',
    );
    const res = await GET(req, { params: { owner: 'ghost', name: 'nope' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.fetch_status).toBe('not_found');
  });

  it('returns 429 when count exceeds the per-key hourly ceiling', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    // The default ceiling is 50_000. We can't override it post-import
    // (zod caches the env at module load), so we pre-seed the bucket
    // at 50_001 — the next GET's atomic upsert brings it to 50_002
    // which exceeds the ceiling and trips 429.
    const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await prisma.rateLimitBucket.upsert({
      where: { apiKeyId: activeKeyId },
      create: { apiKeyId: activeKeyId, windowStart, count: 50_001 },
      update: { count: 50_001, windowStart },
    });
    const res = await GET(
      authedReq(
        'http://localhost/api/v1/repos/octocat/Hello-World',
        activeKeyPlain,
        '203.0.113.4',
      ),
      { params: { owner: 'octocat', name: 'Hello-World' } },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect(res.headers.get('x-ratelimit-limit')).toBe('50000');
    // 50_001+1 = 50_002 hits, limit=50_000, remaining = max(0, 50_000 - 50_002) = 0
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
  });
});

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({
    where: { apiKey: { name: { startsWith: TEST_KEY_PREFIX } } },
  });
  await prisma.apiKey.deleteMany({ where: { name: { startsWith: TEST_KEY_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_KEY_PREFIX } } });
  await prisma.$disconnect();
});
