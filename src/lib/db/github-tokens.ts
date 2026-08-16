import { prisma } from '@/lib/db/client';
import type { Prisma, GithubToken } from '@prisma/client';

export const findTokenByHash = (tokenHash: string): Promise<GithubToken | null> =>
  prisma.githubToken.findUnique({ where: { tokenHash } });

export const listAllTokens = (): Promise<GithubToken[]> => prisma.githubToken.findMany();

export const insertToken = (data: Prisma.GithubTokenUncheckedCreateInput): Promise<GithubToken> =>
  prisma.githubToken.create({ data });

export const updateTokenQuota = (
  id: bigint,
  data: Pick<Prisma.GithubTokenUpdateInput, 'requestsUsed' | 'resetAt' | 'lastUsedAt'>,
): Promise<GithubToken> => prisma.githubToken.update({ where: { id }, data });