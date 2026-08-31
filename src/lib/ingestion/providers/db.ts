import { prisma } from '@/lib/db/client';

/**
 * DB-side CRUD for ingestion_providers. Kept thin — the heavy lifting
 * (parse / preview / run) lives in sibling modules.
 */

export async function listProviders(opts: { enabled?: boolean } = {}) {
  return prisma.ingestionProvider.findMany({
    ...(opts.enabled !== undefined ? { where: { enabled: opts.enabled } } : {}),
    orderBy: { createdAt: 'desc' },
  });
}

export async function getProviderById(id: bigint) {
  return prisma.ingestionProvider.findUnique({ where: { id } });
}

export async function getProviderBySlug(slug: string) {
  return prisma.ingestionProvider.findUnique({ where: { slug } });
}

export async function createProvider(input: {
  slug: string;
  name: string;
  configJson: unknown;
  enabled?: boolean;
}) {
  return prisma.ingestionProvider.create({
    data: {
      slug: input.slug,
      name: input.name,
      sourceType: 'json',
      configJson: input.configJson as never,
      enabled: input.enabled ?? true,
    },
  });
}

export async function updateProvider(
  id: bigint,
  input: { name?: string; configJson?: unknown; enabled?: boolean },
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.configJson !== undefined) data.configJson = input.configJson as never;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return prisma.ingestionProvider.update({ where: { id }, data });
}

export async function deleteProvider(id: bigint) {
  return prisma.ingestionProvider.delete({ where: { id } });
}