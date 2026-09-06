CREATE TABLE `email_config` (
    `id` INT NOT NULL,
    `smtp_host` VARCHAR(255) NOT NULL,
    `smtp_port` INT NOT NULL,
    `smtp_user` VARCHAR(255) NOT NULL,
    `smtp_pass` TEXT NOT NULL,
    `smtp_secure` BOOLEAN NOT NULL DEFAULT false,
    `smtp_from` VARCHAR(255) NOT NULL,
    `reply_to` VARCHAR(255) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `updated_by` BIGINT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `email_config` ADD CONSTRAINT `email_config_singleton_chk` CHECK (`id` = 1);

CREATE TABLE `email_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `recipient` VARCHAR(255) NOT NULL,
    `subject` VARCHAR(500) NOT NULL,
    `template_key` VARCHAR(100) NOT NULL,
    `status` ENUM('queued', 'sent', 'failed') NOT NULL DEFAULT 'queued',
    `error_message` TEXT NULL,
    `related_entity_type` VARCHAR(50) NULL,
    `related_entity_id` VARCHAR(100) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `email_log_status_created_idx`(`status`, `created_at`),
    INDEX `email_log_recipient_created_idx`(`recipient`, `created_at`),
    INDEX `email_log_entity_idx`(`related_entity_type`, `related_entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
