import { generateApiKey } from '@/lib/api-keys/generate';
import { writeAudit } from '@/lib/audit/writer';
import {
  findApiKeyById,
  createApiKeyRow,
  updateApiKeyById,
  updateApiKeyByIdUnchecked,
} from '@/lib/db/api-keys';
import { logger } from '@/lib/logger';
import type { ApiKey } from '@prisma/client';

export interface RequestKeyArgs {
  userId: bigint;
  name: string;
  ip?: string;
}

/**
 * Create a pending ApiKey row. Plain key is generated on approval, not here.
 * A placeholder hash is stored so the unique constraint on keyHash holds;
 * the real hash overwrites it on approve.
 */
export async function requestKey(args: RequestKeyArgs): Promise<ApiKey> {
  const { hash: placeholderHash } = generateApiKey();
  const row = await createApiKeyRow({
    userId: args.userId,
    name: args.name,
    keyPrefix: 'pending',
    keyHash: placeholderHash,
    status: 'pending',
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
