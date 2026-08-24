import { prisma } from '@/lib/db/client';
import type { GithubToken, GithubTokenStatus, Prisma } from '@prisma/client';

export const findTokenByHash = (tokenHash: string): Promise<GithubToken | null> =>
  prisma.githubToken.findUnique({ where: { tokenHash } });

export const listAllTokens = (): Promise<GithubToken[]> => prisma.githubToken.findMany();

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
