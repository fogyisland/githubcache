-- M31: drop the stub-row concept. Pending refresh_jobs may exist without
-- a repositories row (because GitHub hasn't returned yet).
-- 6-step ordering keeps the DB consistent at every point:

ALTER TABLE `refresh_jobs`
  ADD COLUMN `owner` VARCHAR(100) NULL AFTER `repository_id`,
  ADD COLUMN `name`  VARCHAR(200) NULL AFTER `owner`,
  ADD INDEX  `refresh_jobs_owner_name_idx` (`owner`, `name`);

-- Backfill owner/name from existing FK → repositories join.
UPDATE `refresh_jobs` rj
  JOIN `repositories` r ON r.id = rj.repository_id
   SET rj.owner = r.owner,
       rj.name  = r.name
 WHERE rj.owner IS NULL OR rj.name IS NULL;

ALTER TABLE `refresh_jobs`
  MODIFY COLUMN `repository_id` BIGINT NULL,
  DROP FOREIGN KEY `refresh_jobs_repository_id_fkey`;
