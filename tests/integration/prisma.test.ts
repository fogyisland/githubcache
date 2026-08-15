import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/client';

describe('Prisma client', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects and runs a raw query', async () => {
    // MySQL returns integers as BigInt in raw queries; coerce for comparison.
    const rows = await prisma.$queryRaw<Array<{ ok: bigint | number }>>`SELECT 1 AS ok`;
    expect(Number(rows[0]?.ok)).toBe(1);
  });

  it('has the repositories table accessible via Prisma model', async () => {
    // Counts should work even on empty table; this verifies the model is wired
    const count = await prisma.repository.count();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
