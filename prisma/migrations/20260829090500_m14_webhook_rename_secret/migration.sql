-- Originally intended to rename `secret_hash` → `secret`, but the upstream
-- `20260829090000_m14_webhook_subscriptions` migration already created the
-- column as `secret` directly, so the source column never existed and the
-- rename would fail on any database (live or shadow).
--
-- This file is preserved as a no-op so the migration history stays linear
-- (it was recorded as applied in `_prisma_migrations` during initial
-- development). The shadow-DB validation in `prisma migrate dev` would
-- otherwise reject the new m23 migration as failing to apply cleanly.
ALTER TABLE `webhook_subscriptions` MODIFY COLUMN `secret` CHAR(64) NOT NULL;
