// One-shot: delete the 5 rows the verify-flat-fix.mjs used as "fresh" repos.
// They're now in DB from prior runs and would cache-hit instead of triggering
// a fresh storeRepoMetadata. After delete, the API returns 202/pending and
// the scheduler fetch exercises the post-fix upsertRepo + write.ts paths.
import { PrismaClient } from '@prisma/client';

const FIXTURES = [
  'babel/babel', 'webpack/webpack', 'rollup/rollup',
  'parcel-bundler/parcel', 'biomejs/biome',
];

const prisma = new PrismaClient();

async function main() {
  for (const r of FIXTURES) {
    const [owner, name] = r.split('/');
    const row = await prisma.repository.findUnique({
      where: { owner_name: { owner, name } },
      select: { id: true, lastFetchedAt: true },
    });
    if (!row) {
      console.log(`  ${r.padEnd(30)} (already absent)`);
      continue;
    }
    // Delete the repository — child rows (refresh_jobs etc) are cleaned
    // up by FK cascade on the schema's relation.
    await prisma.repository.delete({
      where: { owner_name: { owner, name } },
    });
    console.log(`  ${r.padEnd(30)} deleted id=${row.id.toString()}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
