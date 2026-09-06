import { prisma } from '@/lib/db/client';

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function main(): Promise<void> {
  const rows = await prisma.ingestionProvider.findMany({
    orderBy: { id: 'desc' },
    take: 10,
  });
  console.log(JSON.stringify(rows, replacer, 2));
  await prisma.$disconnect();
}

void main();
