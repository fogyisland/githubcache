-- AlterTable
ALTER TABLE `users` ADD COLUMN `admin_variant` ENUM('mission_control', 'inspector', 'workbench') NOT NULL DEFAULT 'mission_control';
