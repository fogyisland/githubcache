// Create a test API key for the load test. Approved by the existing
// admin user (id 1) so the key is `active` and usable immediately.
import { generateApiKey } from '../src/lib/api-keys/generate';
import { prisma } from '../src/lib/db/client';
import { createApiKeyRow, updateApiKeyByIdUnchecked } from '../src/lib/db/api-keys';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
  if (!admin) throw new Error('no admin user');

  const { plain, prefix, hash } = generateApiKey();
  const row = await createApiKeyRow({
    userId: admin.id,
    name: 'load-test-100repos',
    keyPrefix: prefix,
    keyHash: hash,
    status: 'pending',
  });
  await updateApiKeyByIdUnchecked(row.id, {
    status: 0,
    approvedAt: new Date(),
    approvedBy: admin.id,
  });

  console.log(`CREATED key id=${row.id} prefix=${prefix}`);
  console.log(`PLAIN_KEY=${plain}`);
  console.log(`USER_ID=${admin.id}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });