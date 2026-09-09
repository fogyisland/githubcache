/**
 * First-time DB init CLI (M28.bug24 rewrite).
 *
 * Calls `@/lib/db/init-schema.ensureFreshSchema()` so the wizard's step 3
 * and this CLI both use the same CREATE TABLE IF NOT EXISTS statements.
 *
 * Run from project root after writing .env:
 *   npx tsx scripts/init-db.ts
 *
 * Output is intentionally identical to the wizard's checklist log so
 * ops engineers can copy-paste it into a runbook:
 *   [init-db] created 18 tables
 *   [init-db] marked 22 migrations applied
 *   [init-db] done
 */
import { ensureFreshSchema } from '@/lib/db/init-schema';

async function main(): Promise<void> {
  const result = await ensureFreshSchema();
  console.log(
    `[init-db] ${
      result.alreadyInitialized
        ? 'schema already present — skipping table creation'
        : `created ${result.createdTables} tables`
    }`,
  );
  console.log(`[init-db] marked ${result.markedMigrations} migrations applied`);
  console.log('[init-db] done');
}

main()
  .catch((e: unknown) => {
    console.error('[init-db] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/db/client');
    await prisma.$disconnect().catch(() => undefined);
  });