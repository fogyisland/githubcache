/**
 * M31 smoke-test — preview a provider end-to-end.
 *
 * Usage:
 *   node --import tsx/esm --env-file=.env scripts/m21-smoke-provider.ts <slug> [--limit N]
 *
 * Defaults: slug=comfyui-manager, no limit.
 *
 * M31: bulk insertion via runProvider() was removed per the user directive
 * ("不支持批量提交"). This script now exercises preview-only — to enqueue
 * a repo, query its owner/name individually via the public lookup API.
 */

import { prisma } from '@/lib/db/client';
import { previewProvider } from '@/lib/ingestion/providers/run';
import { poolSize } from '@/lib/github/pool';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'comfyui-manager';
  const limit = getArg('limit') ? Number(getArg('limit')) : undefined;

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
  console.log(`poolSize: ${activeTokens} (${activeTokens > 0 ? 'tokens available — scheduler can drain' : 'NO TOKENS — refresh_jobs will queue but not drain'})`);

  console.log('\n--- preview ---');
  const preview = await previewProvider(slug, { ...(limit !== undefined ? { limit } : {}) });
  console.log(JSON.stringify(preview, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));

  await prisma.$disconnect();
}

void main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
