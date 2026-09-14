-- sync-prod-refresh-jobs.sql
-- One-shot SQL to bring prod githubcache.refresh_jobs in line with the
-- schema.prisma RefreshJob model (M31). The 1.0 schema freeze commit
-- dac89b1 made init-schema.ts the canonical schema source, but the
-- refresh_jobs CREATE TABLE there was stale (no owner/name columns).
-- This script adds the missing columns and index without touching any
-- rows (githubcache.refresh_jobs had 0 rows in production at the time
-- of writing).
--
-- Run once on prod after pulling the init-schema.ts fix commit:
--
--   mysql -h <prod-host> -uroot -p githubcache < scripts/sync-prod-refresh-jobs.sql
--
-- After running, restart the app and smoke-test /admin/ingestion,
-- /admin/refresh, /admin/queue — the P2022 errors will be gone.

-- ---------------------------------------------------------------------------
-- Preflight: refuse to run if refresh_jobs already has rows. The
-- ADD COLUMN ... NOT NULL statements below would fail without a backfill
-- first. If preflight reports ERROR, abort the script and run a backfill
-- UPDATE before re-applying:
--
--   UPDATE refresh_jobs r
--   JOIN repositories repo ON r.repository_id = repo.id
--   SET r.owner = repo.owner, r.name = repo.name;
--
-- ---------------------------------------------------------------------------
SELECT IF(
  (SELECT COUNT(*) FROM refresh_jobs) > 0,
  'ERROR: refresh_jobs has rows — backfill owner/name from repositories first',
  'OK: refresh_jobs is empty, safe to ALTER'
) AS preflight;

-- 1. Make repository_id nullable (M31 intent: queue-on-miss may not
--    have a backing repositories row).
ALTER TABLE refresh_jobs MODIFY COLUMN `repository_id` BIGINT NULL;

-- 2. Add owner column (mirrors repositories.owner so the scheduler
--    can claim batches without joining).
ALTER TABLE refresh_jobs ADD COLUMN `owner` VARCHAR(100) NOT NULL AFTER `repository_id`;

-- 3. Add name column (mirrors repositories.name).
ALTER TABLE refresh_jobs ADD COLUMN `name` VARCHAR(200) NOT NULL AFTER `owner`;

-- 4. Add the (owner, name) composite index used by scheduler batches.
CREATE INDEX `refresh_jobs_owner_name_idx` ON `refresh_jobs` (`owner`, `name`);

-- ---------------------------------------------------------------------------
-- Verify the post-sync shape matches the new init-schema.ts CREATE TABLE.
-- Expected:
--   - owner  VARCHAR(100)  NOT NULL
--   - name   VARCHAR(200)  NOT NULL
--   - repository_id  BIGINT  NULL
--   - index refresh_jobs_owner_name_idx on (owner, name)
-- ---------------------------------------------------------------------------
SHOW CREATE TABLE refresh_jobs\G
SHOW INDEX FROM refresh_jobs;
