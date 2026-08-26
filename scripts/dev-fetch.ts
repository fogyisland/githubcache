#!/usr/bin/env tsx
import { config } from 'dotenv';

config({ path: '.env' });

import { storeRepoMetadata } from '@/lib/cache/write';
import { prisma } from '@/lib/db/client';
import { fetchRepoCore } from '@/lib/github/client';
import { parseRepoResponse } from '@/lib/github/fields';
import { logger } from '@/lib/logger';

async function main(): Promise<void> {
  const arg = process.argv[2] ?? '';
  const [owner, name] = arg.split('/');
  if (!owner || !name) {
    console.error('usage: npm run dev:fetch -- owner/name');
    process.exitCode = 2;
    return;
  }

  try {
    const { data, etag } = await fetchRepoCore(owner, name);
    await storeRepoMetadata({
      owner,
      name,
      node: `${owner}/${name}`,
      metadata: parseRepoResponse(data),
      ...(etag ? { etag } : {}),
      fetchStatus: 'ok',
    });
    console.log(`stored ${owner}/${name} (fetchStatus=ok)`);
  } catch (e: unknown) {
    const err = e as { code?: string; httpStatus?: number; message?: string };
    if (err?.code === 'NOT_FOUND') {
      await storeRepoMetadata({
        owner,
        name,
        node: `${owner}/${name}`,
        metadata: null,
        fetchStatus: 'not_found',
        fetchError: '404',
      });
      console.log(`stored ${owner}/${name} (fetchStatus=not_found)`);
      return;
    }
    logger.error({ err, owner, name }, 'dev-fetch failed');
    console.error(`error: ${err?.message ?? 'unknown'} (status=${err?.httpStatus ?? 'n/a'})`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error('fatal:', e);
  process.exitCode = 1;
});
