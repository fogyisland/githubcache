import { createHash } from 'crypto';
import { prisma } from '@/lib/db/client';
import type { GithubToken, GithubTokenStatus, Prisma } from '@prisma/client';
export type { GithubToken };

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

/**
 * M21 — Overwrite the raw plaintext token on an existing row, recomputing
 * the first4 / last4 / sha256 hash columns so they stay consistent.
 *
 * Used when an operator re-submits the plaintext (e.g. legacy M4 row had
 * `token = NULL`, or operator rotated the PAT on GitHub and wants the new
 * one in the pool immediately).
 *
 * Caller is responsible for activating the new token in the in-memory
 * pool (`addTokenToPool` from `@/lib/github/pool`) — this function only
 * touches the DB.
 */
export async function updateTokenRaw(id: bigint, token: string): Promise<GithubToken> {
  const first4 = token.slice(0, 4);
  const last4 = token.length >= 4 ? token.slice(-4) : token;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return prisma.githubToken.update({
    where: { id },
    data: { token, tokenFirst4: first4, tokenLast4: last4, tokenHash },
  });
}

/**
 * Mark a token disabled and write a corresponding audit log entry. Used by:
 *   - the admin route (`POST /api/admin/github-tokens/[id]/disable`)
 *   - the pool auto-rotation logic (M14.4) when a token accumulates too many
 *     consecutive 429s and the operator hasn't intervened.
 *
 * Audit `action` distinguishes the two paths via the `reason` field in
 * metadata — `operator` for explicit admin action, `auto-rotation` for the
 * pool's consecutive-429 trip.
 *
 * Idempotent: calling this on an already-disabled token still writes a
 * fresh audit row (so the timestamp of the latest disable is preserved).
 */
export async function disableTokenById(
  id: bigint,
  reason: 'operator' | 'auto-rotation',
  actorUserId?: bigint,
): Promise<GithubToken> {
  const row = await prisma.githubToken.update({
    where: { id },
    data: { status: 'disabled' },
  });
  // Fire-and-forget — pool auto-rotation must not block on audit write.
  void import('@/lib/audit/writer').then(async ({ writeAudit }) => {
    try {
      await writeAudit({
        action: 'auto_disable_token',
        targetType: 'github_token',
        targetId: String(row.id),
        ...(actorUserId !== undefined ? { actorUserId } : {}),
        metadata: { label: row.label, reason },
      });
    } catch (e) {
      // Swallow — disable already persisted; audit write failure must not
      // bubble up to the pool caller (would block subsequent picks).
      console.error('disableTokenById audit write failed', e);
    }
  });
  return row;
}

export async function deleteTokenById(id: bigint): Promise<void> {
  await prisma.githubToken.delete({ where: { id } });
}
