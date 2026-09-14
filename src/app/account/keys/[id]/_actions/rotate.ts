'use server';

import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { headers, cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { logger } from '@/lib/logger';
import { sendKeyRotatedEmail } from '@/lib/email/triggers/key-rotated';

const RotateSchema = z.object({
  keyId: z.string().regex(/^\d+$/),
});

export type RotateResult =
  | { ok: true; plaintext: string; newKeyId: string; newKeyName: string }
  | { ok: false; error: 'not_signed_in' | 'forbidden' | 'not_found' | 'not_active' | 'rate_limited' | 'invalid' };

/** Per-user rotation cooldown. The DB enforces this on every call. */
const ROTATE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function getClientIp(headersList: Headers): string {
  const fwd = headersList.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

function getRequestOrigin(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('host');
  if (host) return `${proto}://${host}`;
  const origin = headersList.get('origin');
  return origin ?? '';
}

/**
 * Server action: M31.x self-rotate an API key from /account/keys/[id].
 *
 * Flow:
 *   1. Validate session — error if missing.
 *   2. zod-validate {keyId}.
 *   3. Load the key, check ownership AND status === 'active'.
 *   4. Enforce 24h cooldown — refuse if any key (active or pending)
 *      belonging to this user was rotated in the last 24h. Audit log
 *      is the source of truth for the cooldown (no schema change).
 *   5. Revoke the old key (status='revoked', revokedAt=now()).
 *   6. Generate fresh plaintext + sha256 hash, prefix stays ghc_usr_<4hex>.
 *   7. Insert new ApiKey row with status='pending' (admin still has to
 *      approve the rotated request — matches the existing
 *      self-requested-key flow).
 *   8. Audit `rotate_key_self`.
 *   9. Best-effort email the user notifying them that a rotation
 *      happened and a new request is pending review.
 *
 * Return value: on success, the plaintext is returned exactly once to
 * the client (so the modal can show + copy it). It is NEVER re-fetched
 * from the DB — the row stores the hash only.
 */
export async function rotateOwnKeyAction(formData: FormData): Promise<RotateResult> {
  const parsed = RotateSchema.safeParse({
    keyId: (formData.get('keyId') ?? '').toString(),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid' };
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

  const oldKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!oldKey) return { ok: false, error: 'not_found' };
  if (oldKey.userId !== session.id) {
    return { ok: false, error: 'forbidden' };
  }
  if (oldKey.status !== 'active') {
    return { ok: false, error: 'not_active' };
  }

  // 24h cooldown: look for any `rotate_key_self` audit by this user
  // within the last 24h. We do NOT include admin-initiated rotates
  // here — those don't exist yet, but if they do later, only the
  // self-action should consume the cooldown slot.
  const cooldownSince = new Date(Date.now() - ROTATE_COOLDOWN_MS);
  const recentRotate = await prisma.auditLog.findFirst({
    where: {
      action: 'rotate_key_self',
      actorUserId: session.id,
      createdAt: { gte: cooldownSince },
    },
    select: { id: true },
  });
  if (recentRotate) {
    return { ok: false, error: 'rate_limited' };
  }

  // Generate the new plaintext + hash. Mirrors the prefix scheme used
  // by /account/keys/request so the new row is visually identical to
  // a self-requested key.
  const KEY_PREFIX = 'ghc_usr_';
  const hex = randomBytes(16).toString('hex');
  const plain = `${KEY_PREFIX}${hex}`;
  const hash = createHash('sha256').update(plain).digest('hex');
  const newKeyName = `${oldKey.name} (rotated)`;

  // Revoke old + insert new in one transaction so a partial failure
  // can't leave the user keyless. status='pending' on the new row
  // means an admin still has to approve before the user can use it —
  // matches the self-requested flow.
  const newKey = await prisma.$transaction(async (tx) => {
    await tx.apiKey.update({
      where: { id: keyId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    return tx.apiKey.create({
      data: {
        userId: session.id,
        name: newKeyName,
        keyPrefix: 'ghc_usr_',
        keyHash: hash,
        status: 'pending',
      },
    });
  });
  // keyPrefix is a 2-step write — the prefix column is set after the
  // row exists so the unique constraint on keyHash isn't violated on
  // rotation retry. Same pattern as request.ts.
  await prisma.apiKey.update({
    where: { id: newKey.id },
    data: { keyPrefix: 'ghc_usr_' + hash.slice(0, 4) },
  });

  await writeAudit({
    action: 'rotate_key_self',
    targetType: 'api_key',
    targetId: keyId.toString(),
    actorUserId: session.id,
    metadata: {
      oldKeyName: oldKey.name,
      newKeyId: newKey.id.toString(),
      newKeyName,
    },
    ip: getClientIp(headersList),
  });

  logger.info(
    { oldKeyId: keyId.toString(), newKeyId: newKey.id.toString(), actor: session.id.toString() },
    'self key rotate',
  );

  // Best-effort email. SMTP failure here MUST NOT fail the rotation —
  // the user already saw the plaintext in the modal and the audit log
  // is the durable record.
  try {
    await sendKeyRotatedEmail({
      oldKey: { id: oldKey.id, name: oldKey.name },
      newKey: { id: newKey.id, name: newKey.name },
      owner: session,
      origin: getRequestOrigin(headersList),
    });
  } catch (e: unknown) {
    logger.warn(
      { err: e, oldKeyId: keyId.toString(), newKeyId: newKey.id.toString() },
      'rotate key email failed',
    );
  }

  revalidatePath(`/account/keys/${keyId}`);
  revalidatePath('/account/keys');
  revalidatePath('/admin/api-keys');

  return {
    ok: true,
    plaintext: plain,
    newKeyId: newKey.id.toString(),
    newKeyName,
  };
}
