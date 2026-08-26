import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db/client';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-bucket';
import { incrementIpBucket, windowStartFor } from '@/lib/db/ip-rate-limit';

const TEST_IP_PREFIX = '203.0.113.'; // RFC 5737 documentation range — never real traffic
const TEST_IP_PREFIX_B = '198.51.100.'; // second doc range for isolation tests

function makeIp(suffix: number, prefix = TEST_IP_PREFIX): string {
  return `${prefix}${suffix}`;
}

beforeAll(async () => {
  // Sanity: table exists. If migration did not run, the prisma client will
  // throw on first access below.
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  // Clean up any IPs touched by tests
  await prisma.ipRateLimitBucket.deleteMany({
    where: {
      OR: [
        { ip: { startsWith: TEST_IP_PREFIX } },
        { ip: { startsWith: TEST_IP_PREFIX_B } },
      ],
    },
  });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.ipRateLimitBucket.deleteMany({
    where: {
      OR: [
        { ip: { startsWith: TEST_IP_PREFIX } },
        { ip: { startsWith: TEST_IP_PREFIX_B } },
      ],
    },
  });
});

describe('checkIpRateLimit (durable per-IP bucket)', () => {
  it('allows the first request and counts it as 1', async () => {
    const ip = makeIp(1);
    const r = await checkIpRateLimit(ip, 60);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.limit).toBe(60);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it('allows up to perMinute requests within the window', async () => {
    const ip = makeIp(2);
    const perMinute = 5;
    for (let i = 0; i < perMinute; i++) {
      const r = await checkIpRateLimit(ip, perMinute);
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i + 1);
    }
  });

  it('denies the (perMinute + 1)-th request', async () => {
    const ip = makeIp(3);
    const perMinute = 3;
    for (let i = 0; i < perMinute; i++) {
      const r = await checkIpRateLimit(ip, perMinute);
      expect(r.allowed).toBe(true);
    }
    const r = await checkIpRateLimit(ip, perMinute);
    expect(r.allowed).toBe(false);
    expect(r.count).toBe(perMinute + 1);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('window resets when windowStart is stale (new wall-clock minute)', async () => {
    const ip = makeIp(4);
    const perMinute = 2;

    expect((await checkIpRateLimit(ip, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ip, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ip, perMinute)).allowed).toBe(false);

    // Simulate window rollover: bump windowStart to a stale past value so
    // the next checkIpRateLimit computes a fresh windowStart.
    const now = new Date();
    const staleStart = new Date(now.getTime() - 5 * 60 * 1000);
    await prisma.ipRateLimitBucket.update({
      where: { ip },
      data: { windowStart: staleStart },
    });

    const r = await checkIpRateLimit(ip, perMinute);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it('retryAfterSeconds is positive when denied', async () => {
    const ip = makeIp(5);
    const perMinute = 1;
    await checkIpRateLimit(ip, perMinute);
    const r = await checkIpRateLimit(ip, perMinute);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('is atomic under concurrent calls — exactly perMinute succeed', async () => {
    const ip = makeIp(6);
    const perMinute = 10;
    const total = 100;
    const results = await Promise.all(
      Array.from({ length: total }, () => checkIpRateLimit(ip, perMinute)),
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.filter((r) => !r.allowed).length;
    expect(allowedCount).toBe(perMinute);
    expect(deniedCount).toBe(total - perMinute);
    const final = await prisma.ipRateLimitBucket.findUnique({
      where: { ip },
    });
    expect(final?.count).toBe(total);
  });

  it('per-IP isolation — one IP filling does not affect another', async () => {
    const ipA = makeIp(7, TEST_IP_PREFIX);
    const ipB = makeIp(7, TEST_IP_PREFIX_B); // same suffix, different prefix
    const perMinute = 2;

    expect((await checkIpRateLimit(ipA, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ipA, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ipA, perMinute)).allowed).toBe(false);

    // ipB is independent
    expect((await checkIpRateLimit(ipB, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ipB, perMinute)).allowed).toBe(true);
    expect((await checkIpRateLimit(ipB, perMinute)).allowed).toBe(false);
  });
});

describe('incrementIpBucket (DB helper)', () => {
  it('inserts row with count=1 when no row exists', async () => {
    const ip = makeIp(8);
    const windowStart = windowStartFor(new Date());
    const count = await incrementIpBucket(ip, windowStart);
    expect(count).toBe(1);

    const row = await prisma.ipRateLimitBucket.findUnique({ where: { ip } });
    expect(row?.count).toBe(1);
    expect(row?.windowStart.getTime()).toBe(windowStart.getTime());
  });

  it('increments existing row when windowStart matches', async () => {
    const ip = makeIp(9);
    const windowStart = windowStartFor(new Date());
    await incrementIpBucket(ip, windowStart);
    await incrementIpBucket(ip, windowStart);
    const count = await incrementIpBucket(ip, windowStart);
    expect(count).toBe(3);
  });

  it('resets count when windowStart differs (new window)', async () => {
    const ip = makeIp(10);
    const oldWindow = new Date(Date.now() - 5 * 60 * 1000);
    await incrementIpBucket(ip, oldWindow);
    const newWindow = windowStartFor(new Date());
    const count = await incrementIpBucket(ip, newWindow);
    expect(count).toBe(1);
    const row = await prisma.ipRateLimitBucket.findUnique({ where: { ip } });
    expect(row?.count).toBe(1);
    expect(row?.windowStart.getTime()).toBe(newWindow.getTime());
  });
});
