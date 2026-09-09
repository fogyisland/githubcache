/**
 * One-off CLI to bootstrap the first admin user. Run:
 *
 *   npm run create:admin -- admin@example.com 'your-password-here'
 *
 * Defaults: email=admin@example.com, password=admin-change-me-123
 * (CHANGE THIS on first login — the script does not enforce strength.)
 *
 * Safe to re-run with the same email: existing user is updated (password
 * reset, role forced to admin, status forced to active).
 *
 * NOTE: this script does NOT set the `ghc_setup_done=1` cookie — that's
 * only set by the /init wizard's lockSetupSubtask. For local dev
 * convenience, run the wizard once (3 steps, ~30s) OR set the cookie
 * manually in browser DevTools: `document.cookie = "ghc_setup_done=1;
 * path=/"` then refresh.
 */
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { logger } from '@/lib/logger';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args[0] ?? 'admin@example.com';
  const password = args[1] ?? 'admin-change-me-123';

  if (!email.includes('@') || password.length < 8) {
    console.error('usage: create-admin <email> <password>');
    console.error('  email must contain "@"');
    console.error('  password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'admin',
      status: 'active',
    },
    create: {
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
    },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
  });

  logger.info({ user }, 'admin user upserted');
  // eslint-disable-next-line no-console
  console.log(`OK: ${user.email} (role=${user.role}, status=${user.status})`);
  // eslint-disable-next-line no-console
  console.log('Set ghc_setup_done=1 in your browser cookie to skip the /init wizard:');
  // eslint-disable-next-line no-console
  console.log('  document.cookie = "ghc_setup_done=1; path=/"; location.reload();');
}

main()
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
