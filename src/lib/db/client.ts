import { PrismaClient } from '@prisma/client';

// M11.16 fix: bump the connection-pool ceiling so the rate-limit
// high-concurrency tests (100 concurrent incrementBucket calls) don't
// queue past Prisma's 5s `transaction_timeout` / `connect_timeout` window.
// The default of `num_physical_cpus * 2 + 1` (≈9 on a 4-core box) is too
// small for our workload. Setting `connection_limit = 32` gives ample
// headroom for burst traffic while still leaving room for the scheduler +
// admin requests.
//
// We must inject the query param into DATABASE_URL BEFORE constructing
// the PrismaClient (Prisma parses the URL at construction time).
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '32');
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '30');
  }
  process.env.DATABASE_URL = url.toString();
}

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});