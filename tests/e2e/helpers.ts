import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';

const TEST_ADMIN_PREFIX = 'e2e-admin-';

export async function ensureTestAdmin(): Promise<{ email: string; password: string }> {
  const email = `${TEST_ADMIN_PREFIX}${Date.now()}@example.test`;
  const password = 'test-admin-password-123';
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      status: 'active',
    },
  });
  return { email, password };
}

export async function cleanupTestAdmin(): Promise<void> {
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_ADMIN_PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_ADMIN_PREFIX } } });
  await prisma.$disconnect();
}
