-- CreateTable
CREATE TABLE `webhook_subscriptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `url` VARCHAR(500) NOT NULL,
    `secret` CHAR(64) NOT NULL,
    `event_filter` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_delivery_at` DATETIME(3) NULL,
    `last_delivery_status` VARCHAR(20) NULL,
    `created_by` BIGINT NULL,

    INDEX `webhook_subscriptions_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;