-- M31.1 — enforce NOT NULL on refresh_jobs.owner and refresh_jobs.name.
--
-- Background: M31 (20260913000000_no_stub_pending) added these columns
-- as NULL-able for the migration window so it could INSERT new rows
-- with NULL owner/name while backfilling the legacy repository_id FKs.
-- The backfill completed in the same migration (UPDATE JOIN), but the
-- NOT NULL constraint was never tightened — schema/DB drift was
-- confirmed: live columns show `Null=YES` even though every code path
-- that reads refresh_jobs assumes owner/name are present.
--
-- Pre-flight: orphan-FK rows from the backfill (refresh_jobs whose
-- repository_id references a missing repositories.id) are silently
-- left with NULL owner/name by the UPDATE JOIN. We refuse to apply
-- NOT NULL if any such orphans exist — the operator must clean them
-- up first. After this migration, any future inserts must provide
-- owner/name, which matches the schema.prisma definition.
--
-- Idempotency: MySQL's `MODIFY COLUMN ... NOT NULL` on a column with
-- no NULLs present succeeds even when NOT NULL is already in place.
-- Re-running this migration on a freshly-synced DB is a no-op.

-- Pre-flight: count refresh_jobs rows with NULL owner OR NULL name.
-- This catches the M31 orphan-FK case where the UPDATE JOIN matched
-- 0 rows. If > 0, refuse with a clear error pointing at the cleanup
-- script before the schema change is attempted.
SET @nullCount = (
  SELECT COUNT(*) FROM `refresh_jobs`
  WHERE `owner` IS NULL OR `name` IS NULL
);

-- Use a prepared statement to SIGNAL only when orphans exist. The
-- SIGNAL fires SQLSTATE 45000 (unhandled user-defined exception),
-- which Prisma migrate-deploy surfaces as a hard error and aborts
-- the migration. The message names the exact column + cleanup shape.
SET @msg = CONCAT(
  'M31.1 pre-flight: ',
  @nullCount,
  ' refresh_jobs rows have NULL owner/name. These are orphan-FK leftovers from the M31 UPDATE JOIN. DELETE them first (e.g. DELETE FROM refresh_jobs WHERE repository_id NOT IN (SELECT id FROM repositories) AND (owner IS NULL OR name IS NULL)), then re-run this migration.'
);
SET @signalSql = IF(@nullCount > 0,
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = @msg',
  'DO 0');
PREPARE stmt FROM @signalSql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Tighten to NOT NULL. MySQL accepts the ALTER whether or not the
-- column is already NOT NULL (the storage metadata is overwritten
-- with identical values when no NULLs exist) — re-running the
-- migration on a synced DB is therefore a no-op.
ALTER TABLE `refresh_jobs`
  MODIFY COLUMN `owner` VARCHAR(100) NOT NULL,
  MODIFY COLUMN `name`  VARCHAR(200) NOT NULL;