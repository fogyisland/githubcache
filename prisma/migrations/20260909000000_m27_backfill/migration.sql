-- M27.2 — backfill from the legacy `metadata` JSON column into the
-- normalized facets added in M27.1. Idempotent: re-running the
-- migration is a no-op (UPDATE on existing values + INSERT IGNORE on
-- the (repository_id, tag|tag) unique keys).

-- 1. Core column backfill. JSON_EXTRACT returns NULL for missing keys,
--    so missing `description` etc. stays NULL on the typed column.
--    Booleans: JSON_EXTRACT returns JSON booleans as strings ("true"/
--    "false"), which BOOLEAN/TINYINT(1) refuses. We use a `= true`
--    comparison expression which returns 1/0 directly, then COALESCE
--    the 0 default. NULL comparison → NULL, COALESCE substitutes 0.
UPDATE `repositories`
  SET
    `description`      = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.description')),
    `private`          = COALESCE(JSON_EXTRACT(`metadata`, '$.private') = true, 0),
    `default_branch`   = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.defaultBranch')), 'main'),
    `stars`             = COALESCE(JSON_EXTRACT(`metadata`, '$.stars'), 0),
    `forks`             = COALESCE(JSON_EXTRACT(`metadata`, '$.forks'), 0),
    `watchers`          = COALESCE(JSON_EXTRACT(`metadata`, '$.watchers'), 0),
    `repo_created_at`   = STR_TO_DATE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.createdAt')), 'Z', ''), '%Y-%m-%dT%H:%i:%s'),
    `repo_updated_at`   = STR_TO_DATE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.updatedAt')), 'Z', ''), '%Y-%m-%dT%H:%i:%s'),
    `repo_pushed_at`    = STR_TO_DATE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.pushedAt')), 'Z', ''), '%Y-%m-%dT%H:%i:%s'),
    `language`          = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.language')),
    `license`           = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.license')),
    `topics`            = COALESCE(JSON_EXTRACT(`metadata`, '$.topics'), JSON_ARRAY()),
    `homepage`          = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.homepage')),
    `archived`          = COALESCE(JSON_EXTRACT(`metadata`, '$.archived') = true, 0),
    `disabled`          = COALESCE(JSON_EXTRACT(`metadata`, '$.disabled') = true, 0)
  WHERE `metadata` IS NOT NULL;

-- 2. Releases backfill. For each repo whose metadata contains
--    recentReleases, insert one row per release tag. INSERT IGNORE
--    on (repository_id, tag) so re-runs don't double-insert.
--
--    MySQL 5.7 doesn't have JSON_TABLE; we expand via a 30-row numbers
--    table (UNION ALL). The API only surfaces top-N releases so 30 is
--    plenty for any real repo.
INSERT IGNORE INTO `repo_releases`
  (`repository_id`, `tag`, `name`, `published_at`, `prerelease`, `draft`, `fetched_at`)
SELECT
  r.id                                                            AS repository_id,
  JSON_UNQUOTE(JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].tag')))   AS tag,
  JSON_UNQUOTE(JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].name')))  AS name,
  COALESCE(
    STR_TO_DATE(
      REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].published_at'))), 'Z', ''),
      '%Y-%m-%dT%H:%i:%s'
    ),
    r.last_fetched_at
  ) AS published_at,
  COALESCE(JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].prerelease')) = true, 0) AS prerelease,
  COALESCE(JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].draft')) = true, 0)      AS draft,
  NOW() AS fetched_at
FROM `repositories` r
JOIN (
  SELECT  0 AS i UNION ALL SELECT  1 UNION ALL SELECT  2 UNION ALL SELECT  3 UNION ALL
  SELECT  4 UNION ALL SELECT  5 UNION ALL SELECT  6 UNION ALL SELECT  7 UNION ALL
  SELECT  8 UNION ALL SELECT  9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL
  SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL
  SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL
  SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL
  SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL
  SELECT 28 UNION ALL SELECT 29
) AS n
ON JSON_LENGTH(JSON_EXTRACT(r.`metadata`, '$.recentReleases')) > n.i
WHERE JSON_TYPE(JSON_EXTRACT(r.`metadata`, '$.recentReleases')) = 'ARRAY'
  AND JSON_EXTRACT(r.`metadata`, CONCAT('$.recentReleases[', n.i, '].tag')) IS NOT NULL;

-- 3. Branches backfill. Same pattern.
INSERT IGNORE INTO `repo_branches`
  (`repository_id`, `name`, `protected`, `last_commit_sha`, `fetched_at`)
SELECT
  r.id                                                            AS repository_id,
  JSON_UNQUOTE(JSON_EXTRACT(r.`metadata`, CONCAT('$.branches[', n.i, '].name')))         AS name,
  COALESCE(JSON_EXTRACT(r.`metadata`, CONCAT('$.branches[', n.i, '].protected')) = true, 0) AS protected,
  JSON_UNQUOTE(JSON_EXTRACT(r.`metadata`, CONCAT('$.branches[', n.i, '].lastCommitSha'))) AS last_commit_sha,
  NOW() AS fetched_at
FROM `repositories` r
JOIN (
  SELECT  0 AS i UNION ALL SELECT  1 UNION ALL SELECT  2 UNION ALL SELECT  3 UNION ALL
  SELECT  4 UNION ALL SELECT  5 UNION ALL SELECT  6 UNION ALL SELECT  7 UNION ALL
  SELECT  8 UNION ALL SELECT  9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL
  SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL
  SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
) AS n
ON JSON_LENGTH(JSON_EXTRACT(r.`metadata`, '$.branches')) > n.i
WHERE JSON_TYPE(JSON_EXTRACT(r.`metadata`, '$.branches')) = 'ARRAY'
  AND JSON_EXTRACT(r.`metadata`, CONCAT('$.branches[', n.i, '].name')) IS NOT NULL;

-- 4. Per-facet freshness. Set all three timestamps to lastFetchedAt
--    so the M27.5 scheduler treats existing rows as warm.
UPDATE `repositories`
  SET
    `core_fetched_at`      = `last_fetched_at`,
    `releases_fetched_at`  = `last_fetched_at`,
    `branches_fetched_at`  = `last_fetched_at`
  WHERE `last_fetched_at` IS NOT NULL;
