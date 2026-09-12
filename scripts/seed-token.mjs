// Insert a GitHub token directly via Prisma. The next service restart
// will load it into the pool. Token first4/last4/hash are computed the
// same way the admin API does. PLAINTEXT is masked in stdout.
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const PAT = process.argv[2];
if (!PAT) { console.error('usage: node scripts/seed-token.mjs <github_pat>'); process.exit(2); }

function mask(t) { return t.length <= 8 ? '***' : t.slice(0, 4) + '…' + t.slice(-4); }

async function main() {
  const prisma = new PrismaClient();
  const first4 = PAT.slice(0, 4);
  const last4 = PAT.length >= 4 ? PAT.slice(-4) : PAT;
  const hash = createHash('sha256').update(PAT).digest('hex');

  const dup = await prisma.githubToken.findFirst({ where: { tokenHash: hash } });
  if (dup) {
    console.log(`DUPLICATE — token hash ${hash.slice(0, 8)}… already registered as id=${dup.id} (${dup.status})`);
    await prisma.$disconnect();
    return;
  }

  const row = await prisma.githubToken.create({
    data: {
      label: 'load-test-pat',
      tokenFirst4: first4,
      tokenLast4: last4,
      tokenHash: hash,
      token: PAT,  // stored encrypted by the github-tokens module normally,
                   // but for the load test we insert raw to keep the seed
                   // script self-contained. The real admin API inserts
                   // through insertToken() which handles encryption.
      status: 'active',
    },
  });

  console.log(`CREATED id=${row.id} prefix=${mask(PAT)} label=${row.label}`);
  console.log('NOTE: token inserted raw for load test. To use it for real, the service must restart and load it via initPool.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });