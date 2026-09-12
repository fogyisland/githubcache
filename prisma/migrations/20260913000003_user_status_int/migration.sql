-- M31.x: convert users.user_status from MySQL ENUM to INT
-- Mapping: 'active' → 0, 'disabled' → 2, anything else → 0 (safe default)
--
-- Order matters: UPDATE first (string→int), then ALTER (ENUM→INT).
-- Reversing would fail because MySQL rejects ALTER if disabled rows still hold 'disabled'.

UPDATE users
   SET user_status = CASE user_status
                       WHEN 'active' THEN 0
                       WHEN 'disabled' THEN 2
                       ELSE 0
                     END;

ALTER TABLE users MODIFY COLUMN user_status INT NOT NULL DEFAULT 0;