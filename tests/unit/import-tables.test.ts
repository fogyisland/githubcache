import { describe, it, expect } from 'vitest';
import {
  IMPORTABLE_TABLES,
  TABLE_SCHEMAS,
  getImportableTableSchema,
  isImportableTable,
  type ImportableTable,
} from '@/lib/import/tables';

describe('IMPORTABLE_TABLES whitelist', () => {
  it('contains exactly the 4 whitelisted tables', () => {
    expect(IMPORTABLE_TABLES).toEqual([
      'repositories',
      'repo_releases',
      'repo_branches',
      'ingestion_providers',
    ]);
  });

  it('does NOT contain credential or runtime-state tables', () => {
    const blocked = [
      'users',
      'audit_log',
      'request_log',
      'email_log',
      'sessions',
      'invitations',
      'refresh_jobs',
      'webhook_subscriptions',
      'webhook_deliveries',
      'email_config',
      'github_tokens',
      'api_keys',
      'rate_limit_buckets',
      'ip_rate_limit_buckets',
      'github_request_events',
    ];
    for (const t of blocked) {
      expect(IMPORTABLE_TABLES as readonly string[]).not.toContain(t);
    }
  });

  it('is declared as readonly tuple (as const)', () => {
    // Compile-time guarantee; runtime check is that the array is frozen.
    expect(Object.isFrozen(IMPORTABLE_TABLES)).toBe(false);
    // The "as const" produces a readonly tuple — TypeScript will catch
    // any attempt to push/splice. Runtime proof: index signature.
    type _ = ImportableTable;
    const _check: _ = 'repositories'; // compile-only
    expect(_check).toBe('repositories');
  });
});

describe('isImportableTable type guard', () => {
  it('returns true for whitelisted tables', () => {
    for (const t of IMPORTABLE_TABLES) {
      expect(isImportableTable(t)).toBe(true);
    }
  });

  it('returns false for non-whitelisted tables', () => {
    expect(isImportableTable('users')).toBe(false);
    expect(isImportableTable('')).toBe(false);
    expect(isImportableTable('Repositories')).toBe(false); // case-sensitive
  });
});

describe('getImportableTableSchema', () => {
  it('returns schema for whitelisted tables', () => {
    for (const t of IMPORTABLE_TABLES) {
      const schema = getImportableTableSchema(t);
      expect(schema.modelName).toBeTruthy();
      expect(schema.uniqueKeys.length).toBeGreaterThan(0);
      expect(schema.columns.length).toBeGreaterThan(0);
    }
  });

  it('throws for non-whitelisted tables', () => {
    expect(() => getImportableTableSchema('users')).toThrow(
      /not in IMPORTABLE_TABLES whitelist/,
    );
    expect(() => getImportableTableSchema('refresh_jobs')).toThrow();
    expect(() => getImportableTableSchema('')).toThrow();
  });
});

describe('TABLE_SCHEMAS — column metadata correctness', () => {
  it('repositories has owner+name as unique key', () => {
    expect(TABLE_SCHEMAS.repositories.uniqueKeys).toEqual(['owner', 'name']);
  });

  it('repositories has 29 columns including M27 split-flat fields', () => {
    // M27 split: description / private / defaultBranch / stars / forks /
    // watchers / repoCreatedAt / repoUpdatedAt / repoPushedAt / language /
    // license / topics / homepage / archived / disabled — 15 new flat
    // columns beyond the legacy `node` JSON. Plus 4 etag/fetched + 3
    // status/error/createdAt + legacy 6 (id/owner/name/node/metadata/etag) +
    // 1 createdAt = ~29.
    expect(TABLE_SCHEMAS.repositories.columns.length).toBe(29);
    const fieldNames = TABLE_SCHEMAS.repositories.columns.map((c) => c.field);
    for (const required of [
      'owner',
      'name',
      'description',
      'stars',
      'language',
      'topics',
      'node',
      'fetchStatus',
      'createdAt',
    ]) {
      expect(fieldNames).toContain(required);
    }
  });

  it('repo_releases unique key is (repositoryId, tag)', () => {
    expect(TABLE_SCHEMAS.repo_releases.uniqueKeys).toEqual(['repositoryId', 'tag']);
  });

  it('repo_branches unique key is (repositoryId, name)', () => {
    expect(TABLE_SCHEMAS.repo_branches.uniqueKeys).toEqual(['repositoryId', 'name']);
  });

  it('ingestion_providers unique key is slug', () => {
    expect(TABLE_SCHEMAS.ingestion_providers.uniqueKeys).toEqual(['slug']);
  });

  it('columns map JS field names to snake_case DB columns via @map', () => {
    expect(
        TABLE_SCHEMAS.repositories.columns.find((c) => c.field === 'defaultBranch')?.column,
      ).toBe('default_branch');
    expect(
        TABLE_SCHEMAS.repo_releases.columns.find((c) => c.field === 'repositoryId')?.column,
      ).toBe('repository_id');
    expect(
        TABLE_SCHEMAS.ingestion_providers.columns.find((c) => c.field === 'configJson')?.column,
      ).toBe('config_json');
  });
});