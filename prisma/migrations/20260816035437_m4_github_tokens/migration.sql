-- CreateTable
CREATE TABLE `github_tokens` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(100) NOT NULL,
    `token_first4` CHAR(4) NOT NULL,
    `token_last4` CHAR(4) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `requests_used` INTEGER NOT NULL DEFAULT 0,
    `requests_limit` INTEGER NOT NULL DEFAULT 5000,
    `reset_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `github_tokens_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
