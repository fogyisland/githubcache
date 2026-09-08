-- M19 ingestion_providers — catch-up migration.
--
-- The original m19 migration that creates this table was applied manually
-- to the live DB at some point but never recorded in _prisma_migrations.
-- Schema drift: every fresh deploy since M19 has run `migrate deploy` and
-- silently skipped the table-create, leading to "table ingestion_providers
-- does not exist" 500s on /admin/providers, /api/admin/providers, and
-- the RunViaProvider ingestion card.
--
-- Adding this migration closes the drift. The original column shape is
-- reconstructed from prisma/schema.prisma's IngestionProvider model.

CREATE TABLE `ingestion_providers` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `slug`        VARCHAR(64)  NOT NULL,
  `name`        VARCHAR(128) NOT NULL,
  `source_type` VARCHAR(32)  NOT NULL DEFAULT 'json',
  `config_json` JSON         NOT NULL,
  `enabled`     BOOLEAN      NOT NULL DEFAULT true,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ingestion_providers_slug_key` (`slug`)
);