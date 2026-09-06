import { poolStatus } from './src/lib/github/pool';
import { prisma } from './src/lib/db/client';
async function main() {
  const before = poolStatus();
  console.log('BEFORE poolStatus:', JSON.stringify(before, (_k, v) =>
    v instanceof Date ? v.toISOString() : v, 2));
  const tokens = await prisma.githubToken.findMany({
    select: { id: true, label: true, requestsUsed: true, requestsLimit: true, resetAt: true, lastUsedAt: true },
  });
  console.log('TOKENS in DB:', JSON.stringify(tokens, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : (v instanceof Date ? v.toISOString() : v), 2));
  await prisma.$disconnect();
}
main();
