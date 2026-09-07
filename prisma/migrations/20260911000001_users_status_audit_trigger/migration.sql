-- M27.7 — users_status_audit_trigger
--
-- Background: the admin PATCH /api/admin/users/[id] handler is the only
-- application-level write path for users.user_status, and it always emits
-- an audit_log row (action='disable_user' or 'enable_user'). But manual
-- SQL (or any GUI tool) bypasses that audit, which is exactly what
-- happened on 2026-09-06: 3 admin accounts ended up disabled with zero
-- audit rows, leaving no breadcrumb to figure out who did it.
--
-- This trigger adds a DB-level safety net: any UPDATE that changes
-- users.user_status writes a synthetic audit_log row, regardless of
-- whether the UPDATE came from the application or from a manual query.
--
-- @app_source is a session variable the application sets at the start of
-- each HTTP request (added separately in src/lib/db/client.ts); when set
-- to 'application' it lets us distinguish PATCH handler writes from
-- out-of-band writes. COALESCE falls back to 'sql' for direct DB sessions.

CREATE TRIGGER users_status_audit
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.user_status <> NEW.user_status THEN
    INSERT INTO audit_log (
      action,
      target_type,
      target_id,
      metadata,
      created_at
    ) VALUES (
      IF(NEW.user_status = 'disabled', 'disable_user', 'enable_user'),
      'user',
      CAST(NEW.id AS CHAR),
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