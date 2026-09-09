'use server';

import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';

const RevokeSchema = z.object({
  keyId: z.string().regex(/^\d+$/),
});

function getClientIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Server action: M26 self-revoke an API key from /account/keys/[id].
 *
 * Authorization: the caller must own the key (userId === session.userId)
 * OR be an admin. Anything else returns an error rather than throwing
 * so the page can render a friendly message.
 */
export async function revokeOwnKeyAction(formData: FormData): Promise<void> {
  const parsed = RevokeSchema.safeParse({
    keyId: (formData.get('keyId') ?? '').toString(),
  });
  if (!parsed.success) {
    throw new Error('invalid keyId');
  }
  const keyId = BigInt(parsed.data.keyId);

  const headersList = await headers();
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!session) {
    throw new Error('not signed in');
  }

  const key = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!key) throw new Error('not found');
  if (key.userId !== session.id && session.role !== 'admin') {
    throw new Error('forbidden');
  }
  if (key.status === 'revoked') {
    // Idempotent: re-revalidate + redirect, no DB write.
    revalidatePath(`/account/keys/${keyId}`);
    redirect(`/account/keys/${keyId}`);
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: { status: 'revoked', revokedAt: new Date() },
  });

  await writeAudit({
    action: 'revoke_key_self',
    targetType: 'api_key',
    targetId: keyId.toString(),
    actorUserId: session.id,
    metadata: { name: key.name, byOwner: key.userId === session.id },
    ip: getClientIp(headersList),
  });

  logger.info({ keyId: keyId.toString(), actor: session.id.toString() }, 'self key revoke');

  revalidatePath(`/account/keys/${keyId}`);
  revalidatePath('/account/keys');
  redirect(`/account/keys/${keyId}`);
}
