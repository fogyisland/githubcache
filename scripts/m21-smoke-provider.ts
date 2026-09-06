/**
 * M20.5 smoke-test — preview + run a provider end-to-end.
 *
 * Usage:
 *   node --import tsx/esm --env-file=.env scripts/m21-smoke-provider.ts <slug> [--limit N] [--dryRun]
 *
 * Defaults: slug=comfyui-manager, no limit, real run.
 */

import { prisma } from '@/lib/db/client';
import { previewProvider, runProvider } from '@/lib/ingestion/providers/run';
import { poolSize } from '@/lib/github/pool';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'comfyui-manager';
  const limit = getArg('limit') ? Number(getArg('limit')) : undefined;
  const dryRun = hasFlag('dryRun');

  const provider = await prisma.ingestionProvider.findUnique({
    where: { slug },
  });
  if (!provider) {
    console.error(`provider slug="${slug}" not found`);
    process.exit(1);
  }
  console.log(`provider: id=${provider.id.toString()} slug=${provider.slug} enabled=${provider.enabled}`);
  console.log(`config: ${JSON.stringify(provider.configJson)}`);

  const activeTokens = poolSize();
  console.log(`poolSize: ${activeTokens} (${activeTokens > 0 ? 'tokens available — scheduler can drain' : 'NO TOKENS — jobs will queue but not drain'})`);

  console.log('\n--- preview ---');
  const preview = await previewProvider(slug, { ...(limit !== undefined ? { limit } : {}) });
  console.log(JSON.stringify(preview, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

  if (dryRun) {
    console.log('\n--dryRun set — skipping runProvider');
    return;
  }

  console.log('\n--- run ---');
  const runResult = await runProvider(slug, {
    ...(limit !== undefined ? { limit } : {}),
  });
  console.log(JSON.stringify(runResult, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
