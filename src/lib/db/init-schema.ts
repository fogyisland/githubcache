/**
 * First-time schema initialization (M28.bug24 → simplified).
 *
 * The init wizard's step 3 used to spawn `prisma db push`, which fails on
 * standard managed MySQL (PlanetScale, 阿里云 RDS, Aurora) because db push
 * probes triggers/foreign keys and needs SUPER / SET @@SESSION privileges
 * that these providers deny (P3018 / error 1419). It also spawns a child
 * process from inside a Next.js server action — fragile.
 *
 * This module replaces that with a hard-coded list of `CREATE TABLE IF NOT
 * EXISTS` statements matching the post-M27 schema. Idempotent, runs as a
 * plain Prisma `$executeRawUnsafe`, no SUPER, no subprocess.
 *
 * The list is split out so:
 *   1. Every model in schema.prisma has a matching CREATE TABLE (audit trail)
 *   2. The wizard can also skip table creation if `users` already exists
 *   3. `_prisma_migrations` is still seeded with INSERT IGNORE so a future
 *      `prisma migrate deploy` runs as a no-op
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

/**
 * Single CREATE TABLE statement per model. Add a new entry whenever
 * schema.prisma gains a model — no automatic sync (that's the trade-off
 * vs db push; explicit is cheaper than "why did deploy break again").
 *
 * Schema mirrors schema.prisma as of M27.6 (post-backfill column additions
 * description / stars / forks / language / topics / etc.). `@@map` snake-case
 * names match the migration history.
 *
 * IF NOT EXISTS makes every statement safe to re-run.
 */
const CREATE_TABLE_STATEMENTS: ReadonlyArray<string> = [
  // repositories — core model, M1 + M27 column backfills
  `CREATE TABLE IF NOT EXISTS \`repositories\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`owner\` VARCHAR(100) NOT NULL,
    \`name\` VARCHAR(200) NOT NULL,
    \`description\` TEXT NULL,
    \`private\` BOOLEAN NOT NULL DEFAULT false,
    \`default_branch\` VARCHAR(100) NULL,
    \`stars\` INT NOT NULL DEFAULT 0,
    \`forks\` INT NOT NULL DEFAULT 0,
    \`watchers\` INT NOT NULL DEFAULT 0,
    \`repo_created_at\` DATETIME(3) NULL,
    \`repo_updated_at\` DATETIME(3) NULL,
    \`repo_pushed_at\` DATETIME(3) NULL,
    \`language\` VARCHAR(50) NULL,
    \`license\` VARCHAR(100) NULL,
    \`topics\` JSON NOT NULL,
    \`homepage\` TEXT NULL,
    \`archived\` BOOLEAN NOT NULL DEFAULT false,
    \`disabled\` BOOLEAN NOT NULL DEFAULT false,
    \`node\` JSON NOT NULL,
    \`metadata\` JSON NULL,
    \`etag\` VARCHAR(128) NULL,
    \`releases_etag\` VARCHAR(128) NULL,
    \`branches_etag\` VARCHAR(128) NULL,
    \`last_fetched_at\` DATETIME(3) NULL,
    \`core_fetched_at\` DATETIME(3) NULL,
    \`releases_fetched_at\` DATETIME(3) NULL,
    \`branches_fetched_at\` DATETIME(3) NULL,
    \`fetch_status\` ENUM('ok','not_found','forbidden','error') NOT NULL DEFAULT 'ok',
    \`fetch_error\` TEXT NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`repositories_owner_name_key\`(\`owner\`, \`name\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // users — M3 + M10 + M11 + M13 + M23 + M26 + M27
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`email\` VARCHAR(255) NOT NULL,
    \`password_hash\` VARCHAR(255) NULL,
    \`role\` ENUM('admin','operator') NOT NULL DEFAULT 'operator',
    \`user_status\` ENUM('active','disabled') NOT NULL DEFAULT 'active',
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`last_login_at\` DATETIME(3) NULL,
    \`theme\` ENUM('terminal','editorial','brutalist') NOT NULL DEFAULT 'terminal',
    \`admin_variant\` ENUM('mission_control','inspector','workbench') NOT NULL DEFAULT 'mission_control',
    \`lang\` VARCHAR(8) NOT NULL DEFAULT 'zh',
    \`timezone\` VARCHAR(64) NULL,
    \`signup_source\` ENUM('invited','self') NOT NULL DEFAULT 'self',
    UNIQUE INDEX \`users_email_key\`(\`email\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // sessions — M6 (FK to users)
  `CREATE TABLE IF NOT EXISTS \`sessions\` (
    \`id\` CHAR(43) NOT NULL,
    \`user_id\` BIGINT NOT NULL,
    \`expires_at\` DATETIME(3) NOT NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`ip\` VARCHAR(45) NULL,
    INDEX \`sessions_user_id_idx\`(\`user_id\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`sessions_user_id_fkey\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // invitations — M6 (FK to users for inviter)
  `CREATE TABLE IF NOT EXISTS \`invitations\` (
    \`id\` CHAR(32) NOT NULL,
    \`email\` VARCHAR(255) NOT NULL,
    \`role\` ENUM('admin','operator') NOT NULL,
    \`invited_by\` BIGINT NOT NULL,
    \`expires_at\` DATETIME(3) NOT NULL,
    \`consumed_at\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`invitations_email_idx\`(\`email\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`invitations_invited_by_fkey\` FOREIGN KEY (\`invited_by\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // api_keys — M3 (FK to users + self-referencing approver)
  `CREATE TABLE IF NOT EXISTS \`api_keys\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`user_id\` BIGINT NOT NULL,
    \`name\` VARCHAR(100) NOT NULL,
    \`key_prefix\` VARCHAR(16) NOT NULL,
    \`key_hash\` VARCHAR(64) NOT NULL,
    \`status\` ENUM('pending','active','revoked') NOT NULL DEFAULT 'pending',
    \`rate_limit_per_min\` INT NOT NULL DEFAULT 60,
    \`daily_quota\` INT NOT NULL DEFAULT 10000,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`approved_at\` DATETIME(3) NULL,
    \`approved_by\` BIGINT NULL,
    \`revoked_at\` DATETIME(3) NULL,
    \`last_used_at\` DATETIME(3) NULL,
    UNIQUE INDEX \`api_keys_key_hash_key\`(\`key_hash\`),
    INDEX \`api_keys_status_idx\`(\`status\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`api_keys_user_id_fkey\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT \`api_keys_approved_by_fkey\` FOREIGN KEY (\`approved_by\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // audit_log — M3
  `CREATE TABLE IF NOT EXISTS \`audit_log\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`actor_user_id\` BIGINT NOT NULL,
    \`action\` VARCHAR(100) NOT NULL,
    \`target_type\` VARCHAR(50) NOT NULL,
    \`target_id\` VARCHAR(100) NOT NULL,
    \`metadata\` JSON NULL,
    \`ip\` VARCHAR(45) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`audit_log_action_idx\`(\`action\`),
    INDEX \`audit_log_created_at_idx\`(\`created_at\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // request_log — M3
  `CREATE TABLE IF NOT EXISTS \`request_log\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`api_key_id\` BIGINT NULL,
    \`endpoint\` VARCHAR(100) NOT NULL,
    \`repo_requested\` VARCHAR(300) NULL,
    \`cache_hit\` BOOLEAN NOT NULL,
    \`duration_ms\` INT NOT NULL,
    \`status_code\` INT NOT NULL,
    \`ip\` VARCHAR(45) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`request_log_created_at_idx\`(\`created_at\`),
    INDEX \`request_log_api_key_id_created_at_idx\`(\`api_key_id\`, \`created_at\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // github_tokens — M4 + M21 (raw token column)
  `CREATE TABLE IF NOT EXISTS \`github_tokens\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`label\` VARCHAR(100) NOT NULL,
    \`token_first4\` CHAR(4) NOT NULL,
    \`token_last4\` CHAR(4) NOT NULL,
    \`token_hash\` CHAR(64) NOT NULL,
    \`token\` TEXT NULL,
    \`status\` ENUM('active','disabled') NOT NULL DEFAULT 'active',
    \`requests_used\` INT NOT NULL DEFAULT 0,
    \`requests_limit\` INT NOT NULL DEFAULT 5000,
    \`reset_at\` DATETIME(3) NULL,
    \`last_used_at\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`github_tokens_token_hash_key\`(\`token_hash\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // refresh_jobs — M5 + M27 facet kind (FK to repositories)
  `CREATE TABLE IF NOT EXISTS \`refresh_jobs\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`repository_id\` BIGINT NOT NULL,
    \`job_kind\` ENUM('core','releases','branches') NOT NULL DEFAULT 'core',
    \`priority\` INT NOT NULL DEFAULT 50,
    \`scheduled_for\` DATETIME(3) NOT NULL,
    \`status\` ENUM('pending','in_progress','done','failed') NOT NULL DEFAULT 'pending',
    \`attempts\` INT NOT NULL DEFAULT 0,
    \`last_error\` TEXT NULL,
    \`locked_until\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX \`refresh_jobs_status_scheduled_for_idx\`(\`status\`, \`scheduled_for\`),
    INDEX \`refresh_jobs_status_priority_idx\`(\`status\`, \`priority\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`refresh_jobs_repository_id_fkey\` FOREIGN KEY (\`repository_id\`) REFERENCES \`repositories\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // rate_limit_buckets — M8 (FK to api_keys, CASCADE on api-key delete)
  `CREATE TABLE IF NOT EXISTS \`rate_limit_buckets\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`api_key_id\` BIGINT NOT NULL,
    \`window_start\` DATETIME(3) NOT NULL,
    \`count\` INT NOT NULL DEFAULT 0,
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`rate_limit_buckets_api_key_id_key\`(\`api_key_id\`),
    INDEX \`rate_limit_buckets_window_start_idx\`(\`window_start\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`rate_limit_buckets_api_key_id_fkey\` FOREIGN KEY (\`api_key_id\`) REFERENCES \`api_keys\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // ip_rate_limit_buckets — M9
  `CREATE TABLE IF NOT EXISTS \`ip_rate_limit_buckets\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`ip\` VARCHAR(45) NOT NULL,
    \`window_start\` DATETIME(3) NOT NULL,
    \`count\` INT NOT NULL DEFAULT 0,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`ip_rate_limit_buckets_ip_key\`(\`ip\`),
    INDEX \`ip_rate_limit_buckets_window_start_idx\`(\`window_start\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // webhook_subscriptions — M14.6
  `CREATE TABLE IF NOT EXISTS \`webhook_subscriptions\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`url\` VARCHAR(500) NOT NULL,
    \`secret\` CHAR(64) NOT NULL,
    \`event_filter\` JSON NOT NULL,
    \`active\` BOOLEAN NOT NULL DEFAULT true,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`last_delivery_at\` DATETIME(3) NULL,
    \`last_delivery_status\` VARCHAR(20) NULL,
    \`created_by\` BIGINT NULL,
    INDEX \`webhook_subscriptions_active_idx\`(\`active\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // webhook_deliveries — M14.6 (FK to webhook_subscriptions, CASCADE)
  `CREATE TABLE IF NOT EXISTS \`webhook_deliveries\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`subscription_id\` BIGINT NOT NULL,
    \`event_id\` BIGINT NOT NULL,
    \`event_action\` VARCHAR(100) NOT NULL,
    \`event_target_type\` VARCHAR(50) NOT NULL,
    \`event_target_id\` VARCHAR(100) NOT NULL,
    \`event_created_at\` DATETIME(3) NOT NULL,
    \`payload\` JSON NOT NULL,
    \`attempt_count\` INT NOT NULL DEFAULT 0,
    \`status\` ENUM('pending','delivered','failed','dead') NOT NULL DEFAULT 'pending',
    \`last_attempt_at\` DATETIME(3) NULL,
    \`last_error\` TEXT NULL,
    \`next_retry_at\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX \`webhook_deliveries_status_next_retry_at_idx\`(\`status\`, \`next_retry_at\`),
    INDEX \`webhook_deliveries_subscription_id_created_at_idx\`(\`subscription_id\`, \`created_at\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`webhook_deliveries_subscription_id_fkey\` FOREIGN KEY (\`subscription_id\`) REFERENCES \`webhook_subscriptions\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // ingestion_providers — M19
  `CREATE TABLE IF NOT EXISTS \`ingestion_providers\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`slug\` VARCHAR(64) NOT NULL,
    \`name\` VARCHAR(128) NOT NULL,
    \`source_type\` VARCHAR(32) NOT NULL DEFAULT 'json',
    \`config_json\` JSON NOT NULL,
    \`enabled\` BOOLEAN NOT NULL DEFAULT true,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`ingestion_providers_slug_key\`(\`slug\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // email_config — M25 (single-row, id=1)
  `CREATE TABLE IF NOT EXISTS \`email_config\` (
    \`id\` INT NOT NULL DEFAULT 1,
    \`smtp_host\` VARCHAR(255) NOT NULL,
    \`smtp_port\` INT NOT NULL,
    \`smtp_user\` VARCHAR(255) NOT NULL,
    \`smtp_pass\` TEXT NOT NULL,
    \`smtp_secure\` BOOLEAN NOT NULL DEFAULT false,
    \`smtp_from\` VARCHAR(255) NOT NULL,
    \`reply_to\` VARCHAR(255) NULL,
    \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    \`updated_by\` BIGINT NULL,
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`email_config_single_row\` CHECK (id = 1)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // email_log — M25
  `CREATE TABLE IF NOT EXISTS \`email_log\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`recipient\` VARCHAR(255) NOT NULL,
    \`subject\` VARCHAR(500) NOT NULL,
    \`template_key\` VARCHAR(100) NOT NULL,
    \`status\` ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
    \`error_message\` TEXT NULL,
    \`related_entity_type\` VARCHAR(50) NULL,
    \`related_entity_id\` VARCHAR(100) NULL,
    \`sent_at\` DATETIME(3) NULL,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX \`email_log_status_created_at_idx\`(\`status\`, \`created_at\`),
    INDEX \`email_log_recipient_created_at_idx\`(\`recipient\`, \`created_at\`),
    INDEX \`email_log_related_entity_type_related_entity_id_idx\`(\`related_entity_type\`, \`related_entity_id\`),
    PRIMARY KEY (\`id\`)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // repo_releases — M27 (FK to repositories, CASCADE)
  `CREATE TABLE IF NOT EXISTS \`repo_releases\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`repository_id\` BIGINT NOT NULL,
    \`tag\` VARCHAR(100) NOT NULL,
    \`name\` VARCHAR(255) NULL,
    \`published_at\` DATETIME(3) NOT NULL,
    \`prerelease\` BOOLEAN NOT NULL DEFAULT false,
    \`draft\` BOOLEAN NOT NULL DEFAULT false,
    \`fetched_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`repo_releases_repository_id_tag_key\`(\`repository_id\`, \`tag\`),
    INDEX \`repo_releases_repository_id_published_at_idx\`(\`repository_id\`, \`published_at\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`repo_releases_repository_id_fkey\` FOREIGN KEY (\`repository_id\`) REFERENCES \`repositories\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,

  // repo_branches — M27 (FK to repositories, CASCADE)
  `CREATE TABLE IF NOT EXISTS \`repo_branches\` (
    \`id\` BIGINT NOT NULL AUTO_INCREMENT,
    \`repository_id\` BIGINT NOT NULL,
    \`name\` VARCHAR(100) NOT NULL,
    \`protected\` BOOLEAN NOT NULL DEFAULT false,
    \`last_commit_sha\` VARCHAR(64) NULL,
    \`fetched_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX \`repo_branches_repository_id_name_key\`(\`repository_id\`, \`name\`),
    PRIMARY KEY (\`id\`),
    CONSTRAINT \`repo_branches_repository_id_fkey\` FOREIGN KEY (\`repository_id\`) REFERENCES \`repositories\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Prisma's exact checksum algorithm: SHA256 of the migration file content.
 * Re-computed at init time so any drift between prisma's on-disk file and
 * the recorded checksum is detected on next `migrate deploy`.
 */
function checksumOf(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Does any of our tables already exist? Used as the "fresh database vs
 * pre-existing DB" detector — we can't rely on `INFORMATION_SCHEMA` because
 * managed MySQL sometimes hides it from non-SUPER users.
 *
 * `With` variant takes an injected PrismaClient — the wizard uses a
 * one-shot client so it can clean up after itself; the CLI uses the
 * shared lazy proxy.
 */
async function tablesExist(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

export async function tablesExistWith(client: PrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Recreate `_prisma_migrations` — Prisma 5's bookkeeping table.
 * `prisma db push` drops it because it's not in schema.prisma; we recreate
 * with the exact column shape Prisma expects so future `migrate deploy`
 * works without complaints.
 */
async function ensureMigrationsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(MIGRATIONS_TABLE_DDL);
}

export async function ensureMigrationsTableWith(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(MIGRATIONS_TABLE_DDL);
}

const MIGRATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id VARCHAR(36) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    migration_name VARCHAR(255) NOT NULL,
    finished_at DATETIME(3) NULL,
    applied_steps_count INT NOT NULL DEFAULT 0,
    logs TEXT NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    rolled_back_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX _prisma_migrations_migration_name_key (migration_name)
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

/**
 * Mark every migration file as applied. INSERT IGNORE so re-running is
 * safe; the unique index on migration_name dedupes.
 */
async function markMigrationsApplied(): Promise<number> {
  const migrations = listMigrations();
  for (const name of migrations) {
    await insertMigrationRow(prisma, name);
  }
  return migrations.length;
}

export async function markMigrationsAppliedWith(client: PrismaClient): Promise<number> {
  const migrations = listMigrations();
  for (const name of migrations) {
    await insertMigrationRow(client, name);
  }
  return migrations.length;
}

async function insertMigrationRow(client: PrismaClient, name: string): Promise<void> {
  const sqlPath = join(MIGRATIONS_DIR, name, 'migration.sql');
  const checksum = checksumOf(sqlPath);
  await client.$executeRawUnsafe(
    `INSERT IGNORE INTO _prisma_migrations
      (id, checksum, migration_name, finished_at, applied_steps_count, logs)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    randomBytes(12).toString('hex'),
    checksum,
    name,
    new Date(),
    1,
  );
}

/**
 * Public entry: ensure schema exists + migrations are marked applied.
 *
 * Returns `{ createdTables: number, markedMigrations: number, alreadyInitialized: boolean }`.
 * The wizard's checklist reads this for the success message.
 */
export interface InitSchemaResult {
  ok: true;
  alreadyInitialized: boolean;
  createdTables: number;
  markedMigrations: number;
}

export async function ensureFreshSchema(): Promise<InitSchemaResult> {
  const already = await tablesExist();
  let createdTables = 0;
  if (!already) {
    for (const stmt of CREATE_TABLE_STATEMENTS) {
      await prisma.$executeRawUnsafe(stmt);
      createdTables += 1;
    }
  }
  await ensureMigrationsTable();
  const markedMigrations = await markMigrationsApplied();
  return { ok: true, alreadyInitialized: already, createdTables, markedMigrations };
}

export async function ensureFreshSchemaWith(
  client: PrismaClient,
): Promise<InitSchemaResult> {
  const already = await tablesExistWith(client);
  let createdTables = 0;
  if (!already) {
    for (const stmt of CREATE_TABLE_STATEMENTS) {
      await client.$executeRawUnsafe(stmt);
      createdTables += 1;
    }
  }
  await ensureMigrationsTableWith(client);
  const markedMigrations = await markMigrationsAppliedWith(client);
  return { ok: true, alreadyInitialized: already, createdTables, markedMigrations };
}