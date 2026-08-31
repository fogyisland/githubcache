/**
 * Mint a local-dev API key end-to-end:
 *   1. Find or create an admin user.
 *   2. requestKey() — pending ApiKey row.
 *   3. approveKey() — active ApiKey row + returns plain key.
 * Prints the plain key once; never stored.
 *
 * Usage:  npm run mint:key            # default name "local-dev"
 *         npm run mint:key -- my-key  # custom name
 */
import { prisma } from '@/lib/db/client';
import { requestKey, approveKey } from '@/lib/api-keys/workflow';

async function findOrCreateAdmin(): Promise<bigint> {
  const existing = await prisma.user.findFirst({
    where: { role: 'admin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (existing) return existing.id;
  throw new Error(
    'no admin user found — run `npm run create:admin <email> <password>` first',
  );
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'local-dev';
  const adminId = await findOrCreateAdmin();
  const pending = await requestKey({ userId: adminId, name });
  const { plain, row } = await approveKey({ id: pending.id, actorUserId: adminId });
  console.log('');
  console.log('  API key id:    ', row.id.toString());
  console.log('  key prefix:    ', row.keyPrefix);
  console.log('  rate limit/min:', row.rateLimitPerMin);
  console.log('  daily quota:   ', row.dailyQuota);
  console.log('  plain key (copy now, shown once):');
  console.log('    ' + plain);
  console.log('');
  console.log('  Try it:');
  console.log(`    curl -H "X-API-Key: ${plain}" http://localhost:5002/api/query -d '{"repo":"torvalds/linux"}' -H 'Content-Type: application/json'`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});