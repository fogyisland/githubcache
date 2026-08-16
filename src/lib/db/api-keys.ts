import { prisma } from '@/lib/db/client';
import type { Prisma, ApiKey } from '@prisma/client';

export const findApiKeyByHash = (keyHash: string): Promise<ApiKey | null> =>
  prisma.apiKey.findUnique({ where: { keyHash } });

export const findApiKeyById = (id: bigint): Promise<ApiKey | null> =>
  prisma.apiKey.findUnique({ where: { id } });

export const createApiKeyRow = (data: Prisma.ApiKeyUncheckedCreateInput): Promise<ApiKey> =>
  prisma.apiKey.create({ data });

export const updateApiKeyById = (
  id: bigint,
  data: Prisma.ApiKeyUpdateInput,
): Promise<ApiKey> => prisma.apiKey.update({ where: { id }, data });

/**
 * Use the unchecked variant when you need to set FK columns directly
 * (e.g. approvedBy). The checked variant uses relation objects.
 */
export const updateApiKeyByIdUnchecked = (
  id: bigint,
  data: Prisma.ApiKeyUncheckedUpdateInput,
): Promise<ApiKey> => prisma.apiKey.update({ where: { id }, data });

export const listApiKeysForUser = (userId: bigint): Promise<ApiKey[]> =>
  prisma.apiKey.findMany({ where: { userId } });
