import { prisma } from '@/lib/db/client';

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function main(): Promise<void> {
  const tokens = await prisma.githubToken.findMany({
    orderBy: { id: 'desc' },
    take: 5,
    select: {
      id: true,
      label: true,
      status: true,
      tokenFirst4: true,
      tokenLast4: true,
      // Do NOT include token column (raw secret)
    },
  });
  console.log('--- github_tokens (last 5) ---');
  console.log(JSON.stringify(tokens, replacer, 2));

  // For each token, check if token column is NULL without exposing value
  const tokenNullCheck = await prisma.$queryRaw<{ id: bigint; label: string; token_is_null: number }[]>`
    SELECT id, label, (token IS NULL) AS token_is_null FROM github_tokens ORDER BY id DESC LIMIT 5
  `;
  console.log('\n--- token column null-check ---');
  console.log(JSON.stringify(tokenNullCheck, replacer, 2));

  const counts = await prisma.refreshJob.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('\n--- refresh_jobs by status ---');
  console.log(JSON.stringify(counts, replacer, 2));

  // Look at the most recent done job
  const recentDone = await prisma.refreshJob.findMany({
    where: { status: 'done' },
    orderBy: { updatedAt: 'desc' },
    take: 3,
    include: { repository: { select: { owner: true, name: true } } },
  });
  console.log('\n--- recent done jobs ---');
  console.log(JSON.stringify(recentDone, replacer, 2));

  await prisma.$disconnect();
}

void main();
