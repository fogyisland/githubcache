-- CreateTable
CREATE TABLE `rate_limit_buckets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `api_key_id` BIGINT NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rate_limit_buckets_api_key_id_key`(`api_key_id`),
    INDEX `rate_limit_buckets_window_start_idx`(`window_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rate_limit_buckets` ADD CONSTRAINT `rate_limit_buckets_api_key_id_fkey` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
