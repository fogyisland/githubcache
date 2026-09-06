-- M26 — public /signup flow. Adds a `signup_source` column to `users`
-- so the admin users page can distinguish admin-invited accounts from
-- self-signup accounts.
--
-- `DEFAULT 'self'` so the backfill on existing rows is "self" — the
-- historical reality is that every existing account was created through
-- the admin-invite flow (no public signup pre-M26). We pick `self` as
-- the default rather than `invited` because the upcoming code paths
-- default to `self` and the admin UI explicitly checks for invitation
-- rows to display the `invited` badge — flipping that logic later is
-- easy, but the schema default needs to match the new path.
ALTER TABLE `users`
  ADD COLUMN `signup_source` ENUM('invited', 'self') NOT NULL DEFAULT 'self';
