import { generateApiKey } from '@/lib/api-keys/generate';
import { writeAudit } from '@/lib/audit/writer';
import {
  findApiKeyById,
  createApiKeyRow,
  updateApiKeyById,
  updateApiKeyByIdUnchecked,
} from '@/lib/db/api-keys';
import { logger } from '@/lib/logger';
import { env } from '@/lib/config/env';
import type { ApiKey } from '@prisma/client';

export interface RequestKeyArgs {
  userId: bigint;
  name: string;
  ip?: string;
}

/**
 * Derive per-minute rate limit from the API setting `PUBLIC_REPO_RATE_PER_HOUR`.
 *
 * The /admin/api-settings panel exposes `PUBLIC_REPO_RATE_PER_HOUR` as the
 * canonical per-key hourly ceiling (default 50_000). To keep the
 * "申请时显示 60/分钟" prompt honest with whatever the operator sets in
 * the API settings UI, new key requests inherit rateLimitPerMin =
 * ceil(PUBLIC_REPO_RATE_PER_HOUR / 60). At 50_000/h that's 834/min.
 *
 * Floor of 1 — even a 1/h test setting yields a usable key instead of a
 * zero-quota row that would 429 on the first request.
 */
export function deriveDefaultRatePerMin(perHour: number): number {
  return Math.max(1, Math.ceil(perHour / 60));
}

/**
 * Create a pending ApiKey row. Plain key is generated on approval, not here.
 * A placeholder hash is stored so the unique constraint on keyHash holds;
 * the real hash overwrites it on approve.
 *
 * rateLimitPerMin / dailyQuota are stamped from operator-tunable defaults
 * here so a fresh request inherits the API settings panel values rather
 * than the schema @default (which is hard-coded 60/10000 and not in sync
 * with PUBLIC_REPO_RATE_PER_HOUR). Approve can still override.
 */
export async function requestKey(args: RequestKeyArgs): Promise<ApiKey> {
  const { hash: placeholderHash } = generateApiKey();
  const row = await createApiKeyRow({
    userId: args.userId,
    name: args.name,
    keyPrefix: 'pending',
    keyHash: placeholderHash,
    status: 'pending',
    rateLimitPerMin: deriveDefaultRatePerMin(env.PUBLIC_REPO_RATE_PER_HOUR),
    dailyQuota: 10_000,
  });
  await writeAudit({
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    action: 'request_key',
    targetType: 'api_key',
    targetId: String(row.id),
    actorUserId: args.userId,
  });
  return row;
}

export interface ApproveKeyArgs {
  id: bigint;
  rateLimit?: number;
  dailyQuota?: number;
  actorUserId: bigint;
  ip?: string;
}

export interface ApproveKeyResult {
  plain: string;
  row: ApiKey;
}

export async function approveKey(args: ApproveKeyArgs): Promise<ApproveKeyResult> {
  const existing = await findApiKeyById(args.id);
  if (!existing) throw new Error(`api key ${args.id} not found`);
  if (existing.status === 'revoked') throw new Error(`api key ${args.id} is revoked`);
  const { plain, prefix, hash } = generateApiKey();
  const row = await updateApiKeyByIdUnchecked(args.id, {
    keyHash: hash,
    keyPrefix: prefix,
    // M31.x — persist plaintext so /account/keys list can offer an inline
    // "copy" button. NULL for rows created before this column landed.
    plaintextKey: plain,
    status: 'active',
    approvedAt: new Date(),
    approvedBy: args.actorUserId,
    ...(args.rateLimit !== undefined ? { rateLimitPerMin: args.rateLimit } : {}),
    ...(args.dailyQuota !== undefined ? { dailyQuota: args.dailyQuota } : {}),
  });
  await writeAudit({
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    action: 'approve_key',
    targetType: 'api_key',
    targetId: String(row.id),
    actorUserId: args.actorUserId,
  });
  logger.info({ keyId: row.id, prefix }, 'api key approved');
  return { plain, row };
}

export interface RevokeKeyArgs {
  id: bigint;
  actorUserId: bigint;
  ip?: string;
}

export async function revokeKey(args: RevokeKeyArgs): Promise<ApiKey> {
  const row = await updateApiKeyById(args.id, {
    status: 'revoked',
    revokedAt: new Date(),
  });
  await writeAudit({
    ...(args.ip !== undefined ? { ip: args.ip } : {}),
    action: 'revoke_key',
    targetType: 'api_key',
    targetId: String(row.id),
    actorUserId: args.actorUserId,
  });
  logger.info({ keyId: row.id }, 'api key revoked');
  return row;
}
