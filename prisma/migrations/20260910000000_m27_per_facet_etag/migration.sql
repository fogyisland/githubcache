-- M27.4 — per-facet ETag storage. The `core` job uses
-- `repositories.etag` (already exists). The `releases` and `branches`
-- jobs each get their own ETag column so a 304 on /releases doesn't
-- poison the /branches cache.
ALTER TABLE `repositories`
  ADD COLUMN `releases_etag` VARCHAR(128) NULL,
  ADD COLUMN `branches_etag` VARCHAR(128) NULL;
