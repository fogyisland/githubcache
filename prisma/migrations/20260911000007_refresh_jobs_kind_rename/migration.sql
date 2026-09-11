-- Fix drift: schema has `kind @map("job_kind")` but live DB has the column
-- named `kind` (no map applied). Rename to align DB with the schema-as-
-- committed. Idempotent — uses IF EXISTS checks so re-running on an
-- already-aligned DB is a no-op.
--
-- Background: discovered by scripts/admin-smoke.mjs when /admin/ingestion,
-- /admin/queue, /admin/refresh all 500'd with
--   "The column `verify.refresh_jobs.job_kind` does not exist".
--
-- We keep the column type (ENUM) and default ('core') identical; this is
-- a pure metadata rename.

ALTER TABLE `refresh_jobs`
  CHANGE COLUMN `kind` `job_kind` ENUM('core', 'releases', 'branches') NOT NULL DEFAULT 'core';