'use server';

import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { logger } from '@/lib/logger';

const AdminSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export interface SubmitAdminResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action: create (or promote) the bootstrap admin user.
 *
 * M28.bug12: used by /init wizard step 2. The Prisma client reads DATABASE_URL
 * from .env written by submitDbConfig. If .env is missing or DB unreachable,
 * this fails fast with a clear message.
 */
export async function submitAdminConfig(input: unknown): Promise<SubmitAdminResult> {
  const parsed = AdminSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const { email, password } = parsed.data;

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'init: bcrypt failed');
    return { ok: false, error: '密码哈希失败' };
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Promote to admin/active if a user with this email already exists.
        await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, role: 'admin', status: 'active' },
        });
      } else {
        await prisma.user.create({
          data: {
            email,
            passwordHash,
            role: 'admin',
            status: 'active',
            theme: 'terminal',
            adminVariant: 'mission_control',
            lang: 'zh',
          },
        });
      }
  } catch (e) {
    logger.error({ err: (e as Error).message, email }, 'init: admin upsert failed');
    return { ok: false, error: `数据库写入失败：${(e as Error).message}` };
  }
  return { ok: true };
}