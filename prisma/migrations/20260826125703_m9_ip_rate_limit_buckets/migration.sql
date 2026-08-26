-- CreateTable
CREATE TABLE `ip_rate_limit_buckets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ip` VARCHAR(45) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ip_rate_limit_buckets_ip_key`(`ip`),
    INDEX `ip_rate_limit_buckets_window_start_idx`(`window_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
