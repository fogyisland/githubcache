-- M23 — per-user timezone preference. Nullable column with a server-side
-- DEFAULT of 'Asia/Shanghai' so existing rows are backfilled atomically
-- as part of the ALTER (no separate data migration script needed).
--
-- The originally-planned combined `m19 + m23` migration was simplified
-- because `ingestion_providers` already exists in the live DB (the m19
-- migration was applied manually at some point but never recorded in
-- `_prisma_migrations` — drift). A separate, single-statement m23 keeps
-- this migration idempotent and easy to validate.
ALTER TABLE `users`
  ADD COLUMN `timezone` VARCHAR(64) NULL DEFAULT 'Asia/Shanghai';
