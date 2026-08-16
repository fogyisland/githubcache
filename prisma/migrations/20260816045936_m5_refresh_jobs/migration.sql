-- CreateTable
CREATE TABLE `refresh_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `repository_id` BIGINT NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 50,
    `scheduled_for` DATETIME(3) NOT NULL,
    `status` ENUM('pending', 'in_progress', 'done', 'failed') NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `locked_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `refresh_jobs_status_scheduled_for_idx`(`status`, `scheduled_for`),
    INDEX `refresh_jobs_status_priority_idx`(`status`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_jobs` ADD CONSTRAINT `refresh_jobs_repository_id_fkey` FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
