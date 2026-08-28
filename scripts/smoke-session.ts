// One-off script: create a session for the first admin user, print the
// session ID + expiry for curl-based smoke testing. Run:
//
//   npm run smoke:session
import { prisma } from '@/lib/db/client';
import { createSession } from '@/lib/db/sessions';

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { role: 'admin', status: 'active' },
    orderBy: { id: 'asc' },
  });
  if (!user) {
    console.error('NO_ADMIN_USER');
    process.exit(1);
  }
  const { id, expiresAt } = await createSession(user.id);
  console.log(`SESSION_ID=${id}`);
  console.log(`USER_EMAIL=${user.email}`);
  console.log(`EXPIRES_AT=${expiresAt.toISOString()}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());