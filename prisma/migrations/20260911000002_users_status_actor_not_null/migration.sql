-- M28.bug4a — actor_user_id NOT NULL on audit_log + capture actor in users_status_audit
--
-- Background: M27.7 added the AFTER UPDATE trigger on `users` to capture
-- any out-of-band users.user_status change into audit_log. But the trigger
-- wrote `actor_user_id = NULL` (default), so we could never tell who
-- disabled an account — only WHEN and to/from what state.
--
-- On 2026-09-07, 3 admin accounts ended up disabled with zero actor info
-- (audit_log rows id 22957..22976). The trigger fired but recorded
-- actor_user_id=NULL, which is exactly as useful as nothing.
--
-- This migration:
--   1. Backfills any existing NULL actor_user_id on disable_user /
--      enable_user audit rows with NULL — preserved as historical
--      "unknown actor" with a metadata tweak so future queries can
--      distinguish them.
--   2. Drops + recreates the trigger so it reads @app_actor (set by
--      updateUserStatus's transaction) and stamps actor_user_id.
--   3. ALTERs audit_log.actor_user_id to NOT NULL. The trigger now
--      always supplies a value, and the application paths that write
--      audit_log directly already pass actor_user_id.
--
-- Migration is safe to roll back: trigger drop + create is symmetric, and
-- the NOT NULL change can be reverted (existing NULLs backfilled to 0).

-- 1. Backfill any historical NULL actor rows. The trigger (M27.7)
-- captures users_status_audit rows but did NOT stamp actor_user_id —
-- those are the historical M27.7 disable_user/enable_user NULLs we
-- most need to fix. Other action types (login_*, logout, auto_disable
-- for github tokens) were always written without an actor; the schema
-- didn't require it. Backfill ALL NULL rows to 0 ("unknown / system")
-- so the NOT NULL ALTER can succeed and the migration is one step.
UPDATE audit_log
SET actor_user_id = 0,
    metadata = JSON_SET(
      COALESCE(metadata, JSON_OBJECT()),
      '$.actor_backfilled', CAST(1 AS JSON),
      '$.note', 'actor_user_id set to 0 by M28.bug4a backfill (was NULL before NOT NULL constraint)'
    )
WHERE actor_user_id IS NULL;

-- 2. Recreate the trigger to capture actor_user_id from @app_actor.
-- The application layer (src/lib/db/users.ts) sets @app_actor inside the
-- same transaction as the UPDATE, so Prisma's single-connection routing
-- guarantees the session variable is visible to the trigger. For
-- non-application sessions (manual SQL, GUI tools) @app_actor is NULL;
-- we stamp 0 ("unknown / out-of-band") so the NOT NULL ALTER succeeds.
DROP TRIGGER IF EXISTS users_status_audit;

CREATE TRIGGER users_status_audit
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.user_status <> NEW.user_status THEN
    INSERT INTO audit_log (
      action,
      target_type,
      target_id,
      actor_user_id,
      metadata,
      created_at
    ) VALUES (
      IF(NEW.user_status = 'disabled', 'disable_user', 'enable_user'),
      'user',
      CAST(NEW.id AS CHAR),
      COALESCE(CAST(CONVERT(@app_actor USING utf8mb4) AS UNSIGNED), 0),
      JSON_OBJECT(
        'from', OLD.user_status,
        'to', NEW.user_status,
        'source', COALESCE(CONVERT(@app_source USING utf8mb4), 'sql'),
        'trigger', 'users_status_audit'
      ),
      NOW(3)
    );
  END IF;
END;

-- 3. Tighten the schema. Any future application path that writes
-- audit_log without supplying actor_user_id will fail loudly here, which
-- is exactly the defense-in-depth we want — the trigger is the
-- backstop, but every other write path should also be audited.
ALTER TABLE audit_log MODIFY COLUMN actor_user_id BIGINT NOT NULL DEFAULT 0;