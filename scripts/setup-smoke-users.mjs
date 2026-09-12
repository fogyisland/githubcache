// One-shot: enable raymond.xu@booming.one (admin) and create an operator
// user (operator@smoke.local) for the M30.8 sidebar-groups smoke gate.
// Idempotent — safe to re-run.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'raymond.xu@booming.one';
const ADMIN_PASS = 'Admin909217';
const OPERATOR_EMAIL = 'operator@smoke.local';
const OPERATOR_PASS = 'Operator909217';
const BCRYPT_COST = 12;

async function upsertActiveUser(email, password, role) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  // M31.x.b — don't bundle status=0 into the upsert: split so the
  // status flip goes through the `users_status_audit` shadow trigger
  // and leaves a `user_status_changed_shadow` audit row with
  // actor_user_id=0 (script has no logged-in operator).
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role },
    create: {
      email,
      passwordHash,
      role,
      theme: 'terminal',
      adminVariant: 'mission_control',
      lang: 'zh',
    },
  });
  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET @app_source = ''"),
    prisma.$executeRawUnsafe('SET @app_actor = 0'),
    prisma.user.update({ where: { id: user.id }, data: { status: 0 } }),
  ]);
  return user;
}

const admin = await upsertActiveUser(ADMIN_EMAIL, ADMIN_PASS, 'admin');
const operator = await upsertActiveUser(OPERATOR_EMAIL, OPERATOR_PASS, 'operator');

console.log(JSON.stringify({
  admin: { email: admin.email, role: admin.role, status: admin.status },
  operator: { email: operator.email, role: operator.role, status: operator.status },
}, null, 2));

await prisma.$disconnect();