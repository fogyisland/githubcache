-- CreateTable
CREATE TABLE `repositories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `owner` VARCHAR(100) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `node` JSON NOT NULL,
    `metadata` JSON NULL,
    `etag` VARCHAR(64) NULL,
    `last_fetched_at` DATETIME(3) NULL,
    `fetch_status` ENUM('ok', 'not_found', 'forbidden', 'error') NOT NULL DEFAULT 'ok',
    `fetch_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `repositories_owner_name_key`(`owner`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
