-- Rename secret_hash → secret. The original migration stored sha256(secret)
-- but the delivery worker needs the raw secret to HMAC-sign each payload.
-- We can't sign with a hash, so we store the raw hex secret directly. The
-- secret is shown once at creation/rotation and never recoverable from
-- this column. CHAR(64) is sufficient for 32 bytes of random entropy
-- hex-encoded.
ALTER TABLE `webhook_subscriptions` CHANGE COLUMN `secret_hash` `secret` CHAR(64) NOT NULL;