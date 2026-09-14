-- AlterTable
ALTER TABLE `api_keys` ADD COLUMN `plaintext_key` VARCHAR(64) NULL AFTER `key_hash`;