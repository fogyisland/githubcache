import { findRepoByCanonical } from '@/lib/db/repositories';
import type { FetchStatus } from '@prisma/client';

export type RepoMetadataResult =
  | {
      found: true;
      metadata: unknown;
      lastFetchedAt: Date | null;
      fetchStatus: Exclude<FetchStatus, 'not_found'>;
      etag: string | null;
    }
  | {
      found: true;
      metadata: null;
      lastFetchedAt: Date | null;
      fetchStatus: 'not_found';
      etag: string | null;
    }
  | { found: false };

export async function getRepoMetadata(owner: string, name: string): Promise<RepoMetadataResult> {
  const row = await findRepoByCanonical(owner, name);
  if (!row) return { found: false };
  if (row.fetchStatus === 'not_found') {
    return {
      found: true,
      metadata: null,
      lastFetchedAt: row.lastFetchedAt,
      fetchStatus: 'not_found',
      etag: row.etag,
    };
  }
  return {
    found: true,
    metadata: row.metadata,
    lastFetchedAt: row.lastFetchedAt,
    fetchStatus: row.fetchStatus,
    etag: row.etag,
  };
}
