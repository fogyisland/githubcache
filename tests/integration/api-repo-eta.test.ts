import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { GET } from '@/app/api/v1/repos/[owner]/[name]/route';
import { prisma } from '@/lib/db/client';

const TEST_KEY_PREFIX = 'm30-7c-eta-it-';
const OWNER = 'm30-7c-eta-it';
const NAME = 'probe';

let activeKeyPlain: string;

async function cleanup(): Promise<void> {
  // refresh_jobs has FK to repositories — delete them first.
  await prisma.refreshJob.deleteMany({ where: { repository: { owner: OWNER } } });
  await prisma.repository.deleteMany({ where: { owner: OWNER } });
  // Scope cleanup by the test key prefix (apiKeys + their FK owners).
  await prisma.rateLimitBucket.deleteMany({
    where: { apiKey: { name: { startsWith: TEST_KEY_PREFIX } } },
  });
  await prisma.apiKey.deleteMany({ where: { name: { startsWith: TEST_KEY_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_KEY_PREFIX } } });
}

beforeAll(async () => {
  await cleanup();
  // Seed a fresh operator user + active apiKey (per established pattern).
  const op = await prisma.user.create({
    data: {
      email: `${TEST_KEY_PREFIX}-op-${Date.now()}@example.test`,
      role: 'operator',
      status: 'active',
      passwordHash: 'placeholder',
      signupSource: 'self',
    },
  });
  const plain = `ghc_test_${randomBytes(16).toString('hex')}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  await prisma.apiKey.create({
    data: {
      userId: op.id,
      name: `${TEST_KEY_PREFIX}-active-${Date.now()}`,
      keyPrefix: 'ghc_test_',
      keyHash: hash,
      status: 'active',
    },
  });
  activeKeyPlain = plain;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('GET /api/v1/repos — 202 ETA payload', () => {
  it('1) cache miss returns 202 with expected_at > queued_at and new fields', async () => {
    const req = new Request(
      `http://localhost/api/v1/repos/${OWNER}/${NAME}`,
      { headers: { 'x-api-key': activeKeyPlain } },
    );
    const res = await GET(req, { params: { owner: OWNER, name: NAME } });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.fetch_status).toBe('pending');
    expect(body.repository).toEqual({ owner: OWNER, name: NAME });
    expect(typeof body.queued_at).toBe('string');
    expect(typeof body.scheduled_for).toBe('string');
    expect(typeof body.expected_at).toBe('string');
    expect(typeof body.scheduler_tick_ms).toBe('number');
    expect(body.scheduler_tick_ms).toBeGreaterThan(0);
    expect(typeof body.scheduler_batch_size).toBe('number');
    expect(body.scheduler_batch_size).toBeGreaterThan(0);
    expect(body.result_url).toBe(`/api/v1/repos/${OWNER}/${NAME}`);
    // ETA is strictly later than the queue time.
    expect(Date.parse(body.expected_at)).toBeGreaterThan(Date.parse(body.queued_at));
  });
});
