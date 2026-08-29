import { prisma } from '@/lib/db/client';
import type { Prisma, ApiKey, ApiKeyStatus, User } from '@prisma/client';

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

// -----------------------------------------------------------------------------
// M7.2 — admin SPA: list / detail / limit-update helpers
// -----------------------------------------------------------------------------

/**
 * An API key joined with the minimal owner fields needed for display.
 *
 * Note: this does NOT include `keyHash` — that field is never returned to
 * the admin UI (the plaintext key is shown ONCE at approval time and is
 * unrecoverable afterwards).
 */
export type ApiKeyWithOwner = ApiKey & { user: Pick<User, 'id' | 'email' | 'role'> };

/**
 * List API keys (admin view), newest first. Optional status filter; always
 * includes the owner's id / email / role. Returns a page + the total
 * matching count so callers can render pagination controls (M14.2).
 */
export async function listApiKeys(opts: {
  status?: ApiKeyStatus;
  skip: number;
  take: number;
}): Promise<{ rows: ApiKeyWithOwner[]; total: number }> {
  const where: Prisma.ApiKeyWhereInput = {};
  if (opts.status) where.status = opts.status;
  const [rows, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.apiKey.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Get a single API key by id, with owner info and the request count from
 * the last 24 hours. Returns null if the key doesn't exist.
 *
 * `requestCountLast24h` powers the "Requests (last 24h)" KPI on the detail
 * page. Single COUNT query — no N+1.
 */
export async function getApiKeyById(
  id: bigint,
): Promise<(ApiKeyWithOwner & { requestCountLast24h: number }) | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, role: true } },
    },
  });
  if (!key) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const requestCountLast24h = await prisma.requestLog.count({
    where: { apiKeyId: id, createdAt: { gte: since } },
  });

  return { ...key, requestCountLast24h };
}

/**
 * Update the rate-limit and daily-quota fields on an API key.
 *
 * Atomic single UPDATE — no transaction needed. Returns the updated row
 * (caller does not normally use the return value; this is for tests +
 * symmetry with the workflow helpers).
 */
export async function updateApiKeyLimits(
  id: bigint,
  limits: { rateLimitPerMin: number; dailyQuota: number },
): Promise<ApiKey> {
  return prisma.apiKey.update({
    where: { id },
    data: {
      rateLimitPerMin: limits.rateLimitPerMin,
      dailyQuota: limits.dailyQuota,
    },
  });
}
