-- AlterTable
ALTER TABLE `users` ADD COLUMN `theme` ENUM('terminal', 'editorial', 'brutalist') NOT NULL DEFAULT 'terminal';
