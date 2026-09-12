/**
 * Install the `users_status_audit` MySQL trigger that mirrors all direct-SQL
 * writes to `users.user_status` into the `audit_log` table as
 * `user_status_changed_shadow` rows.
 *
 * This trigger is part of M31.x.b. The Prisma migration
 * 20260913000005_user_status_audit_trigger can only DROP it (Prisma's
 * prepared-statement protocol rejects `BEGIN ... END` trigger bodies, and
 * `DELIMITER` is not supported either — see the migration file's narrative
 * comment for the full rationale). On a fresh database the migration's DROP
 * is a no-op; THIS script must then be run once to actually create the
 * trigger body.
 *
 * Idempotent: re-running drops + recreates the trigger, leaving audit_log
 * unchanged.
 *
 * Usage:
 *   node scripts/install-status-trigger.mjs
 *
 * Reads DATABASE_URL from .env (same convention as Prisma).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function loadDbUrl() {
  try {
    const content = readFileSync('.env', 'utf8');
    const m = /^DATABASE_URL=(.+)$/m.exec(content);
    if (!m || !m[1]) throw new Error('.env missing DATABASE_URL');
    return m[1].trim().replace(/^['"]|['"]$/g, '');
  } catch (e) {
    console.error('REFUSED:', (e instanceof Error ? e.message : String(e)));
    process.exit(2);
  }
}

// `prisma db execute` uses the mysql2 connector directly, which can parse
// CREATE TRIGGER bodies without DELIMITER (it's a single BEGIN..END
// statement terminated by `;`). It is the only path that actually creates
// the trigger — `prisma migrate deploy` rejects it.
const TRIGGER_SQL = `
CREATE TRIGGER users_status_audit
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF @app_source = 'application' THEN
    SET @app_source = NULL;
  ELSEIF NEW.user_status <> OLD.user_status THEN
    INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata, created_at)
    VALUES (COALESCE(NULLIF(@app_actor, ''), 0), 'user_status_changed_shadow', 'user', NEW.id, JSON_OBJECT('previousStatus', OLD.user_status, 'newStatus', NEW.user_status, 'source', 'db_trigger'), NOW(3));
  END IF;
END
`;

const url = loadDbUrl();
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  // mysql2 escape hatch — Prisma client doesn't expose multi-statement raw,
  // so we use $queryRawUnsafe which the underlying driver forwards verbatim.
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS users_status_audit');
  await prisma.$executeRawUnsafe(TRIGGER_SQL);
  console.log('OK: users_status_audit trigger installed');
} catch (e) {
  console.error('FAILED:', e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}