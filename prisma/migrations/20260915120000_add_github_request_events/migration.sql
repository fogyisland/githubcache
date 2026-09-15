-- M32.7.6 — per-call upstream GitHub request log for the /admin
-- "GitHub upstream API calls" chart. One row per successful upstream
-- HTTP round-trip. Retention: 7 days, pruned by
-- src/lib/scheduler/cron-prune-events.ts.
CREATE TABLE `github_request_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `endpoint` VARCHAR(32) NOT NULL,
  `token_id` BIGINT NULL,
  `status_code` INT NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `github_request_events_occurred_at_idx`(`occurred_at`),
  INDEX `github_request_events_endpoint_occurred_at_idx`(`endpoint`, `occurred_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
