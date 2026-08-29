import { prisma } from '@/lib/db/client';
import type { GithubToken, GithubTokenStatus, Prisma } from '@prisma/client';

export const findTokenByHash = (tokenHash: string): Promise<GithubToken | null> =>
  prisma.githubToken.findUnique({ where: { tokenHash } });

/**
 * List GitHub tokens (admin view), newest first. Returns a page + the
 * total matching count so callers can render pagination controls (M14.2).
 * `listAllTokens()` was removed — callers that need the full list should
 * set a high `take` or iterate.
 */
export async function listAllTokens(opts: {
  skip: number;
  take: number;
}): Promise<{ rows: GithubToken[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.githubToken.findMany({
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.githubToken.count(),
  ]);
  return { rows, total };
}

export const getTokenById = (id: bigint): Promise<GithubToken | null> =>
  prisma.githubToken.findUnique({ where: { id } });

export const insertToken = (data: Prisma.GithubTokenUncheckedCreateInput): Promise<GithubToken> =>
  prisma.githubToken.create({ data });

export const updateTokenQuota = (
  id: bigint,
  data: Pick<Prisma.GithubTokenUpdateInput, 'requestsUsed' | 'resetAt' | 'lastUsedAt'>,
): Promise<GithubToken> => prisma.githubToken.update({ where: { id }, data });

export function updateTokenStatus(id: bigint, status: GithubTokenStatus): Promise<GithubToken> {
  return prisma.githubToken.update({
    where: { id },
    data: { status },
  });
}

export async function deleteTokenById(id: bigint): Promise<void> {
  await prisma.githubToken.delete({ where: { id } });
}
