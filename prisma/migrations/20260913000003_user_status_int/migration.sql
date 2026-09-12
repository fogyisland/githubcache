-- M31.x: convert users.user_status from MySQL ENUM to INT
-- Mapping: 'active' → 0, 'disabled' → 2 (anything else → 0 as safe default)
--
-- Three-step conversion: MySQL ENUM rejects integer SET expressions
-- under strict mode (ER_TRUNCATED_WRONG_VALUE = 1265), and ENUM ordinals
-- are 1-based ('active'=1, 'disabled'=2) — directly converting to INT
-- would leave 'active' at 1 instead of the desired 0. Going through a
-- temporary VARCHAR sidesteps both problems.

-- Step 1: ENUM → VARCHAR(20) so the column accepts arbitrary string writes.
ALTER TABLE users MODIFY COLUMN user_status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Step 2: Map each old string value to its new INT (as a VARCHAR, since the
-- column is still VARCHAR right now). 'active' → '0', 'disabled' → '2'.
UPDATE users
   SET user_status = CASE user_status
                       WHEN 'active' THEN '0'
                       WHEN 'disabled' THEN '2'
                       ELSE '0'
                     END;

-- Step 3: VARCHAR → INT. MySQL casts '0' → 0 and '2' → 2 cleanly.
ALTER TABLE users MODIFY COLUMN user_status INT NOT NULL DEFAULT 0;