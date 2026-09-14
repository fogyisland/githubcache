-- sync-prod-api-keys-plaintext.sql
-- One-shot SQL to bring prod githubcache.api_keys in line with the
-- M31.x schema change. Mirrors the pattern in
-- scripts/sync-prod-refresh-jobs.sql — the prod DB predates the
-- plaintext_key column; running this adds it so the new
-- /account/keys "Copy" button can reveal plaintexts on rows that were
-- approved or rotated after deploy.
--
-- Run once on prod:
--   mysql -h <prod-host> -uroot -p githubcache < scripts/sync-prod-api-keys-plaintext.sql
--
-- Existing rows have plaintext_key = NULL — the UI must direct those
-- users to rotate. No data loss: plaintext_key is additive; key_hash
-- still works for lookup.

-- Preflight: refuse if rows exist? No — this is additive, NULL is the
-- safe default. Existing rows just won't have plaintext until rotated.

-- Add the column.
ALTER TABLE api_keys ADD COLUMN `plaintext_key` VARCHAR(64) NULL AFTER `key_hash`;

-- Verify.
SHOW CREATE TABLE api_keys\G