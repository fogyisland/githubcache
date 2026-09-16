/**
 * Whitelist of tables that the cross-database import feature is allowed
 * to read from a source MySQL instance and INSERT IGNORE into the
 * target `githubcache` database.
 *
 * Hard rule: every table here must (1) have a `@@map` in `schema.prisma`,
 * (2) be a real production table (no staging scratch tables), and (3)
 * have an unambiguous "row identity" suitable for INSERT IGNORE — either
 * an autoincrement PK that the source carries with it, or a natural
 * unique key.
 *
 * Disallowed by design: `users`, `audit_log`, `request_log`, `email_log`,
 * `sessions`, `invitations`, `refresh_jobs`, `webhook_*`, `email_config`,
 * `github_tokens`, `api_keys`, `rate_limit_*` — these hold credentials,
 * session tokens, or runtime state that must not migrate between
 * instances.
 */
export const IMPORTABLE_TABLES = [
  'repositories',
  'repo_releases',
  'repo_branches',
  'ingestion_providers',
] as const;

export type ImportableTable = (typeof IMPORTABLE_TABLES)[number];

export type ColumnSpec = {
  /** Prisma field name (camelCase). */
  field: string;
  /** DB column name (snake_case, matches `@@map` or `@map`). */
  column: string;
  /** JS type of the value after parse. */
  jsType: 'string' | 'number' | 'bigint' | 'boolean' | 'date' | 'json';
  /** True if the DB allows NULL. */
  nullable: boolean;
};

/**
 * Per-table column metadata. Used by the dry-run sampler to project a
 * preview row and by the apply path to map source rows into the
 * Prisma `createMany` payload (the DB column may differ from the JS
 * field name because of `@@map`).
 *
 * Columns are listed in Prisma-field order. M27's split-flat-column
 * additions (description, stars, etc.) are listed explicitly so the
 * import path can `INSERT IGNORE` them alongside the JSON `node`
 * payload.
 */
export const TABLE_SCHEMAS: Record<
  ImportableTable,
  {
    modelName: string;
    uniqueKeys: string[];
    columns: ColumnSpec[];
  }
> = {
  repositories: {
    modelName: 'repository',
    uniqueKeys: ['owner', 'name'],
    columns: [
      { field: 'owner', column: 'owner', jsType: 'string', nullable: false },
      { field: 'name', column: 'name', jsType: 'string', nullable: false },
      { field: 'description', column: 'description', jsType: 'string', nullable: true },
      { field: 'private', column: 'private', jsType: 'boolean', nullable: false },
      { field: 'defaultBranch', column: 'default_branch', jsType: 'string', nullable: true },
      { field: 'stars', column: 'stars', jsType: 'number', nullable: false },
      { field: 'forks', column: 'forks', jsType: 'number', nullable: false },
      { field: 'watchers', column: 'watchers', jsType: 'number', nullable: false },
      { field: 'repoCreatedAt', column: 'repo_created_at', jsType: 'date', nullable: true },
      { field: 'repoUpdatedAt', column: 'repo_updated_at', jsType: 'date', nullable: true },
      { field: 'repoPushedAt', column: 'repo_pushed_at', jsType: 'date', nullable: true },
      { field: 'language', column: 'language', jsType: 'string', nullable: true },
      { field: 'license', column: 'license', jsType: 'string', nullable: true },
      { field: 'topics', column: 'topics', jsType: 'json', nullable: false },
      { field: 'homepage', column: 'homepage', jsType: 'string', nullable: true },
      { field: 'archived', column: 'archived', jsType: 'boolean', nullable: false },
      { field: 'disabled', column: 'disabled', jsType: 'boolean', nullable: false },
      { field: 'node', column: 'node', jsType: 'json', nullable: false },
      { field: 'metadata', column: 'metadata', jsType: 'json', nullable: true },
      { field: 'etag', column: 'etag', jsType: 'string', nullable: true },
      { field: 'releasesEtag', column: 'releases_etag', jsType: 'string', nullable: true },
      { field: 'branchesEtag', column: 'branches_etag', jsType: 'string', nullable: true },
      { field: 'lastFetchedAt', column: 'last_fetched_at', jsType: 'date', nullable: true },
      { field: 'coreFetchedAt', column: 'core_fetched_at', jsType: 'date', nullable: true },
      { field: 'releasesFetchedAt', column: 'releases_fetched_at', jsType: 'date', nullable: true },
      { field: 'branchesFetchedAt', column: 'branches_fetched_at', jsType: 'date', nullable: true },
      { field: 'fetchStatus', column: 'fetch_status', jsType: 'string', nullable: false },
      { field: 'fetchError', column: 'fetch_error', jsType: 'string', nullable: true },
      { field: 'createdAt', column: 'created_at', jsType: 'date', nullable: false },
    ],
  },
  repo_releases: {
    modelName: 'repoRelease',
    uniqueKeys: ['repositoryId', 'tag'],
    columns: [
      { field: 'repositoryId', column: 'repository_id', jsType: 'bigint', nullable: false },
      { field: 'tag', column: 'tag', jsType: 'string', nullable: false },
      { field: 'name', column: 'name', jsType: 'string', nullable: true },
      { field: 'publishedAt', column: 'published_at', jsType: 'date', nullable: false },
      { field: 'prerelease', column: 'prerelease', jsType: 'boolean', nullable: false },
      { field: 'draft', column: 'draft', jsType: 'boolean', nullable: false },
      { field: 'fetchedAt', column: 'fetched_at', jsType: 'date', nullable: false },
    ],
  },
  repo_branches: {
    modelName: 'repoBranch',
    uniqueKeys: ['repositoryId', 'name'],
    columns: [
      { field: 'repositoryId', column: 'repository_id', jsType: 'bigint', nullable: false },
      { field: 'name', column: 'name', jsType: 'string', nullable: false },
      { field: 'protected', column: 'protected', jsType: 'boolean', nullable: false },
      { field: 'lastCommitSha', column: 'last_commit_sha', jsType: 'string', nullable: true },
      { field: 'fetchedAt', column: 'fetched_at', jsType: 'date', nullable: false },
    ],
  },
  ingestion_providers: {
    modelName: 'ingestionProvider',
    uniqueKeys: ['slug'],
    columns: [
      { field: 'slug', column: 'slug', jsType: 'string', nullable: false },
      { field: 'name', column: 'name', jsType: 'string', nullable: false },
      { field: 'sourceType', column: 'source_type', jsType: 'string', nullable: false },
      { field: 'configJson', column: 'config_json', jsType: 'json', nullable: false },
      { field: 'enabled', column: 'enabled', jsType: 'boolean', nullable: false },
      { field: 'createdAt', column: 'created_at', jsType: 'date', nullable: false },
      { field: 'updatedAt', column: 'updated_at', jsType: 'date', nullable: false },
    ],
  },
};

/**
 * Look up the schema metadata for a whitelisted table name.
 * Throws if the name isn't in `IMPORTABLE_TABLES` — callers should
 * validate first (routes already do, but defense in depth).
 */
export function getImportableTableSchema(name: string): {
  modelName: string;
  uniqueKeys: string[];
  columns: ColumnSpec[];
} {
  if (!isImportableTable(name)) {
    throw new Error(`Table '${name}' is not in IMPORTABLE_TABLES whitelist`);
  }
  return TABLE_SCHEMAS[name];
}

/** Type guard for the whitelist. */
export function isImportableTable(name: string): name is ImportableTable {
  return (IMPORTABLE_TABLES as readonly string[]).includes(name);
}