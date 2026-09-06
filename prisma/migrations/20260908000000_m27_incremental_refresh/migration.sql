-- M27.1 — incremental cache refresh: add normalized facets.
-- Additive only. No data movement, no behavior change. The legacy
-- `metadata` JSON column stays readable until M27.6 drops it.

-- 1. New columns on repositories. All nullable / default 0 so the
--    migration is safe to run live against a populated DB.
ALTER TABLE `repositories`
  ADD COLUMN `description`          TEXT NULL,
  ADD COLUMN `private`              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `default_branch`       VARCHAR(100) NOT NULL DEFAULT 'main',
  ADD COLUMN `stars`                INT NOT NULL DEFAULT 0,
  ADD COLUMN `forks`                INT NOT NULL DEFAULT 0,
  ADD COLUMN `watchers`             INT NOT NULL DEFAULT 0,
  ADD COLUMN `repo_created_at`      DATETIME(3) NULL,
  ADD COLUMN `repo_updated_at`      DATETIME(3) NULL,
  ADD COLUMN `repo_pushed_at`       DATETIME(3) NULL,
  ADD COLUMN `language`             VARCHAR(50) NULL,
  ADD COLUMN `license`              VARCHAR(100) NULL,
  ADD COLUMN `topics`               JSON NOT NULL,
  ADD COLUMN `homepage`             TEXT NULL,
  ADD COLUMN `archived`             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `disabled`             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `core_fetched_at`      DATETIME(3) NULL,
  ADD COLUMN `releases_fetched_at`  DATETIME(3) NULL,
  ADD COLUMN `branches_fetched_at`  DATETIME(3) NULL;

-- 2. New tables. repo_releases and repo_branches cascade on
--    repository delete so cleanup is one-line later.
CREATE TABLE `repo_releases` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `repository_id` BIGINT       NOT NULL,
  `tag`           VARCHAR(100) NOT NULL,
  `name`          VARCHAR(255) NULL,
  `published_at`  DATETIME(3)  NOT NULL,
  `prerelease`    BOOLEAN      NOT NULL DEFAULT false,
  `draft`         BOOLEAN      NOT NULL DEFAULT false,
  `fetched_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `repo_releases_repo_tag_key` (`repository_id`, `tag`),
  KEY `repo_releases_repo_pub_idx` (`repository_id`, `published_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `repo_branches` (
  `id`               BIGINT       NOT NULL AUTO_INCREMENT,
  `repository_id`    BIGINT       NOT NULL,
  `name`             VARCHAR(100) NOT NULL,
  `protected`        BOOLEAN      NOT NULL DEFAULT false,
  `last_commit_sha`  VARCHAR(64)  NULL,
  `fetched_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `repo_branches_repo_name_key` (`repository_id`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. New enum + column on refresh_jobs. Default 'core' so existing
--    jobs keep their pre-M27 behavior (full re-fetch).
ALTER TABLE `refresh_jobs`
  ADD COLUMN `job_kind` ENUM('core', 'releases', 'branches') NOT NULL DEFAULT 'core';
