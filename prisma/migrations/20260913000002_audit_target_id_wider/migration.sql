-- M31.1 — widen audit_log.target_id from VARCHAR(100) to VARCHAR(400).
--
-- Background: M31's queue-on-miss path writes audit rows whose
-- targetId is `${owner}/${name}` (see src/lib/jobs/refresh-one.ts's
-- ESCALATION_AUDIT_ACTION + repo_forbidden paths). At
-- VARCHAR(100) that string is at risk of truncation on repos with
-- long owner/name combinations (e.g. organisations with deep
-- hierarchies) — silent truncation because the column is NOT NULL
-- would produce misleading audit entries that don't round-trip.
--
-- 400 chars comfortably fits owner(100) + "/" + name(200) = 301,
-- plus a buffer for any future "type:id" or "owner/name#ref"
-- shapes the audit layer might adopt.
--
-- Idempotency: MODIFY COLUMN with the same type the column already
-- has is a no-op. Re-running on a synced DB is harmless.

ALTER TABLE `audit_log`
  MODIFY COLUMN `target_id` VARCHAR(400) NOT NULL;