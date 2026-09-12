// M31 pre-flight — print pending refreshJob counts before applying the
// `20260913000000_no_stub_pending` migration.
//
// The migration drops the FK `refresh_jobs.repository_id → repositories.id`
// and switches repositoryId to NULLABLE. Until Task 3/4 land
// (`enqueueRefresh` no longer pre-creates a stub row, and `refresh-one.ts`
// rewrites its claim to lookup by owner/name), pending jobs may still be
// pointing at a repositories row that the legacy stub path wrote.
//
// After the application-side changes land, a "pending" job MAY exist
// without a backing repositories row (that's the whole point of M31).
// Until then, this script gates on:
//   1. total pending count (baseline observation)
//   2. orphan count = pending jobs whose repositoryId is set but the row
//      no longer exists. Operator must delete these before the FK drop
//      to keep refresh_jobs consistent with the queue-on-miss rewrite.
//
// Run ad-hoc:  `npm run db:check-drift` style
//   npx tsx --env-file=.env scripts/migrations/backfill-pending-jobs.ts
//
// Exit codes:
//   0 — zero orphans, safe to apply the migration
//   1 — orphan count > 0 OR query failed; operator action required

import { prisma } from '@/lib/db/client';

interface PendingBreakdown {
  total: number;
  orphans: number;
  nonOrphans: number;
}

async function countPendingOrphans(): Promise<PendingBreakdown> {
  // Step 1: total pending (any repositoryId value — including null).
  const total = await prisma.refreshJob.count({
    where: { status: 'pending' },
  });

  if (total === 0) {
    return { total: 0, orphans: 0, nonOrphans: 0 };
  }

  // Step 2: orphan detection.
  // An "orphan" is a pending job with a non-null repositoryId whose
  // repositories row no longer exists. After M31 the RefreshJob →
  // Repository relation is gone, so we can't use Prisma's `repository:
  // { is: null }` relation filter — fetch the candidate IDs and verify
  // each one against the repositories table in a single IN query.
  //
  // Note: a pending job with repositoryId = NULL is NOT an orphan — that's
  // the new M31 shape (refresh job enqueued before any 200/304 from
  // GitHub). Only count the ones that STILL claim a missing FK.
  const candidates = await prisma.refreshJob.findMany({
    where: {
      status: 'pending',
      repositoryId: { not: null },
    },
    select: { repositoryId: true },
  });

  const candidateIds = candidates
    .map((c) => c.repositoryId)
    .filter((id): id is bigint => id !== null);

  if (candidateIds.length === 0) {
    return { total, orphans: 0, nonOrphans: total };
  }

  const existingRepos = await prisma.repository.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true },
  });
  const existingIdSet = new Set(existingRepos.map((r) => r.id.toString()));

  const orphans = candidateIds.filter(
    (id) => !existingIdSet.has(id.toString()),
  ).length;
  const nonOrphans = total - orphans;
  return { total, orphans, nonOrphans };
}

async function main(): Promise<void> {
  const breakdown = await countPendingOrphans();

  console.log('M31 pre-flight — pending refresh_jobs breakdown:');
  console.log(`  total pending:      ${breakdown.total}`);
  console.log(`  orphan pending:     ${breakdown.orphans}`);
  console.log(`  non-orphan pending: ${breakdown.nonOrphans}`);

  if (breakdown.orphans > 0) {
    console.error(
      `\n✗ ${breakdown.orphans} pending refresh_job(s) reference a ` +
        `repositories row that no longer exists. Resolve before applying ` +
        `the M31 migration (FK drop):`,
    );
    console.error(
      "   1) Inspect: prisma.refreshJob.findMany({ where: { status: 'pending', " +
        "repositoryId: { not: null }, repository: { is: null } } })",
    );
    console.error('   2) Either delete them or recreate the backing repositories row.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\n✓ no orphan pending jobs — safe to apply the M31 migration.');
  await prisma.$disconnect();
}

void main().catch(async (e: unknown) => {
  console.error('backfill-pending-jobs failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
