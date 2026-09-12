/**
 * One-shot: dry-run lookup for `raymond.xu@booming.one` so the user can
 * confirm the target row exists and review current role/status before
 * committing to a write. Pass `--write` to actually update the
 * password hash.
 *
 * Usage:
 *   node scripts/reset-admin-password.mjs           # dry-run (read-only)
 *   node scripts/reset-admin-password.mjs --write   # update passwordHash
 *
 * Refuses to run unless the target row is `role=admin`. Refuses to
 * run with `--write` unless the env var `ALLOW_PASSWORD_RESET=1` is
 * set — this is a deliberate friction gate so a pasted chat snippet
 * can't silently rewrite an admin's hash.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import process from 'node:process';
import readline from 'node:readline';

const TARGET_EMAIL = 'raymond.xu@booming.one';
const NEW_PASSWORD = 'Admin909217';
const BCRYPT_COST = 12; // match src/lib/auth/password.ts

const args = new Set(process.argv.slice(2));
const isWrite = args.has('--write');
const env = process.env;

if (env.NODE_ENV === 'production' && isWrite) {
  console.error('REFUSED: refusing --write in production. Set NODE_ENV=development or unset it.');
  process.exit(2);
}
if (isWrite && env.ALLOW_PASSWORD_RESET !== '1') {
  console.error('REFUSED: set ALLOW_PASSWORD_RESET=1 to permit password rewrite.');
  process.exit(2);
}

const prisma = new PrismaClient();

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    console.error(`REFUSED: no user with email=${TARGET_EMAIL}`);
    process.exit(1);
  }

  if (user.role !== 'admin') {
    console.error(`REFUSED: target is role=${user.role}, not admin. Aborting.`);
    process.exit(1);
  }

  // Prisma returns BigInt for autoincrement PK columns; coerce for JSON.
  const printable = {
    ...user,
    id: String(user.id),
    createdAt: user.createdAt?.toISOString?.() ?? null,
    lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
  };
  console.log('Target user:');
  console.log(JSON.stringify(printable, null, 2));

  if (!isWrite) {
    console.log('\nDry-run only. Pass --write (with ALLOW_PASSWORD_RESET=1) to update passwordHash.');
    return;
  }

  const answer = await confirm(`\nType 'yes' to rewrite password for ${user.email} (role=${user.role}) → ${NEW_PASSWORD}\n> `);
  if (answer !== 'yes') {
    console.log('Aborted.');
    return;
  }

  const passwordHash = await bcrypt.hash(NEW_PASSWORD, BCRYPT_COST);
  // M31.x.b — split the password rewrite from the status write so the
  // status flip goes through the `users_status_audit` shadow trigger.
  // Forcing status=0 here would produce a `user_status_changed_shadow`
  // audit row with actor_user_id=0 (script has no logged-in operator),
  // which is exactly the right shape — the row is visible but no human
  // is falsely blamed.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET @app_source = ''"),
    prisma.$executeRawUnsafe('SET @app_actor = 0'),
    prisma.user.update({ where: { id: user.id }, data: { status: 0 } }),
  ]);
  console.log('Updated:', JSON.stringify(
    {
      ...updated,
      id: String(updated.id),
      createdAt: updated.createdAt.toISOString?.() ?? null,
    },
    null,
    2,
  ));
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());