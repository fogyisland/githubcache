-- M14 webhook_deliveries — catch-up migration.
--
-- The m14 migration that originally created webhook_subscriptions was
-- applied manually to the live DB but never recorded in _prisma_migrations.
-- Same drift pattern as M19's ingestion_providers table: schema was
-- updated (M14.6 added WebhookDelivery), but no migration file creates
-- the table. Every fresh deploy silently skips the CREATE TABLE,
-- leading to P2021 errors in the webhook worker.
--
-- Catch-up migration creates the table from the current schema.prisma
-- WebhookDelivery model.

CREATE TABLE `webhook_deliveries` (
  `id`                BIGINT       NOT NULL AUTO_INCREMENT,
  `subscription_id`   BIGINT       NOT NULL,
  `event_id`          BIGINT       NOT NULL,
  `event_action`      VARCHAR(100) NOT NULL,
  `event_target_type` VARCHAR(50)  NOT NULL,
  `event_target_id`   VARCHAR(100) NOT NULL,
  `event_created_at`  DATETIME(3)  NOT NULL,
  `payload`           JSON         NOT NULL,
  `attempt_count`     INT          NOT NULL DEFAULT 0,
  `status`            ENUM('pending','success','failed','retrying') NOT NULL DEFAULT 'pending',
  `last_attempt_at`   DATETIME(3)  NULL,
  `last_error`        TEXT         NULL,
  `next_retry_at`     DATETIME(3)  NULL,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `webhook_deliveries_status_next_retry_at_idx` (`status`, `next_retry_at`),
  INDEX `webhook_deliveries_subscription_id_created_at_idx` (`subscription_id`, `created_at`),

  PRIMARY KEY (`id`),
  CONSTRAINT `webhook_deliveries_subscription_id_fkey`
    FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;