'use server';

import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';

const RevealSchema = z.object({
  keyId: z.string().regex(/^\d+$/),
});

export type RevealResult =
  | { ok: true; plaintext: string }
  | { ok: false; error: 'not_signed_in' | 'forbidden' | 'not_found' | 'no_plaintext' | 'rate_limited' };

/**
 * Per-user cooldown for revealing a plaintext key. Tight window — the
 * plaintext is the user's own key, but we rate-limit anyway to bound
 * blast radius if a session is hijacked.
 */
const REVEAL_COOLDOWN_MS = 60 * 1000;

function getClientIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * M31.x — Reveal an existing API key's plaintext so the inline "Copy"
 * button on /account/keys can write it to the clipboard.
 *
 * Authorization: owner of the key OR session.role === 'admin'. Any
 * other session is `forbidden`.
 *
 * Plaintext availability: only rows that were approved or rotated
 * AFTER the plaintext_key column landed have a value. Pre-existing
 * rows return `no_plaintext` — the UI must then guide the user to
 * rotate.
 *
 * Rate limit: 60s per user. Audit log is the source of truth.
 */
export async function revealOwnKeyAction(formData: FormData): Promise<RevealResult> {
  const parsed = RevealSchema.safeParse({
    keyId: (formData.get('keyId') ?? '').toString(),
  });
  if (!parsed.success) {
    return { ok: false, error: 'forbidden' };
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
    return { ok: false, error: 'not_signed_in' };
  }

  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: {
      id: true,
      userId: true,
      plaintextKey: true,
      status: true,
      name: true,
    },
  });
  if (!key) return { ok: false, error: 'not_found' };
  const isOwner = key.userId === session.id;
  const isAdmin = session.role === 'admin';
  if (!isOwner && !isAdmin) {
    return { ok: false, error: 'forbidden' };
  }
  if (!key.plaintextKey) {
    return { ok: false, error: 'no_plaintext' };
  }

  // Cooldown: any reveal_key_self audit by this user in the last 60s.
  const cooldownSince = new Date(Date.now() - REVEAL_COOLDOWN_MS);
  const recent = await prisma.auditLog.findFirst({
    where: {
      action: 'reveal_key_self',
      actorUserId: session.id,
      createdAt: { gte: cooldownSince },
    },
    select: { id: true },
  });
  if (recent) {
    return { ok: false, error: 'rate_limited' };
  }

  await writeAudit({
    action: 'reveal_key_self',
    targetType: 'api_key',
    targetId: keyId.toString(),
    actorUserId: session.id,
    metadata: {
      keyName: key.name,
      ownerId: key.userId.toString(),
      viaAdmin: isAdmin && !isOwner,
    },
    ip: getClientIp(headersList),
  });
  logger.info(
    {
      keyId: keyId.toString(),
      actor: session.id.toString(),
      viaAdmin: isAdmin && !isOwner,
    },
    'self key reveal',
  );

  return { ok: true, plaintext: key.plaintextKey };
}