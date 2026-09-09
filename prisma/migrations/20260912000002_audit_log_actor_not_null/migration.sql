-- M28.bug21 — tighten audit_log.actor_user_id to NOT NULL.
--
-- The original M27.7 plan was a DB trigger that wrote audit rows on
-- any users.user_status change, including out-of-band manual SQL.
-- The trigger needed SUPER privilege on MySQL, which standard
-- managed-MySQL hosts don't grant — every fresh deploy since M27.7
-- has failed at migrate deploy with P3018/1419.
--
-- Replacement strategy: tighten actor_user_id to NOT NULL so manual
-- SQL that omits the actor fails LOUDLY (table-write error) instead
-- of silently inserting a row with actor_user_id=NULL. The DB
-- trigger is gone; the application code (writeAudit() at 28+ sites)
-- is the only audit-write path, and every caller passes actorUserId.
--
-- Sentinel 0 means "actor not recorded" — used only as the backfill
-- value for any pre-existing NULL rows. Going forward, every audit
-- row has a real actor_user_id (>= 1) or fails to insert.

UPDATE `audit_log`
  SET actor_user_id = 0
  WHERE actor_user_id IS NULL;

ALTER TABLE `audit_log`
  MODIFY COLUMN `actor_user_id` BIGINT NOT NULL DEFAULT 0;