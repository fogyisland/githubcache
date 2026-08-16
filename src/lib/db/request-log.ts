import { prisma } from '@/lib/db/client';
import type { RequestLog } from '@prisma/client';

export interface RecordRequestArgs {
  apiKeyId?: bigint;
  endpoint: string;
  repoRequested?: string;
  cacheHit: boolean;
  durationMs: number;
  statusCode: number;
  ip?: string;
}

export async function recordRequest(args: RecordRequestArgs): Promise<RequestLog> {
  return prisma.requestLog.create({
    data: {
      endpoint: args.endpoint,
      cacheHit: args.cacheHit,
      durationMs: args.durationMs,
      statusCode: args.statusCode,
      ...(args.apiKeyId !== undefined ? { apiKeyId: args.apiKeyId } : {}),
      ...(args.repoRequested !== undefined ? { repoRequested: args.repoRequested } : {}),
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
    },
  });
}
