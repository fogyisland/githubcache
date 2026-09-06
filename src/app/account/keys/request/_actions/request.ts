'use server';

import { z } from 'zod';
import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'crypto';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { writeAudit } from '@/lib/audit/writer';
import { sendKeyRequestedEmail } from '@/lib/email/triggers/key-requested';
import { logger } from '@/lib/logger';

export interface RequestKeyState {
  status: 'idle' | 'ok' | 'invalid' | 'error';
  message?: string;
  fieldErrors?: { name?: string; description?: string };
}

const RequestKeySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

/**
 * Generate the plaintext + hash for a self-requested API key.
 *
 * Mirrors `src/lib/api-keys/generate.ts` (used by the admin approve
 * path) but uses the `ghc_usr_` prefix instead of `ghc_live_` so the
 * two key populations are visually distinguishable in logs and
 * dashboards. The prefix shown in the UI is the first 4 hex chars
 * after `ghc_usr_`; the row stores the literal string `ghc_usr_<hex>`
 * as the prefix column for grep-ability.
 */
function generateUserApiKey(): { plain: string; prefix: string; hash: string } {
  const KEY_PREFIX = 'ghc_usr_';
  const hex = randomBytes(16).toString('hex');
  const plain = `${KEY_PREFIX}${hex}`;
  const prefix = plain.slice(0, KEY_PREFIX.length + 4);
  const hash = createHash('sha256').update(plain).digest('hex');
  return { plain, prefix, hash };
}

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
 * Server action: M26 self-service API key request.
 *
 * Flow:
 *   1. Validate session (cookie-backed) — return error if missing.
 *   2. zod-validate {name, description}.
 *   3. Generate plaintext key + sha256 hash.
 *   4. Insert ApiKey row with status=pending, userId=session.userId.
 *   5. Audit `request_key_self` (distinct from admin's `request_key`).
 *   6. Fire key-requested email to every admin.
 *   7. Redirect to /account/keys.
 *
 * Note: M26 only allows ONE pending request per user at a time —
 * pre-existing pending keys block new requests with a friendly error
 * instead of stacking them.
 */
export async function requestKeyAction(
  _prev: RequestKeyState,
  formData: FormData,
): Promise<RequestKeyState> {
  const headersList = headers();
  const ip = getClientIp(headersList);

  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!session) {
    return { status: 'error', message: 'You must be signed in to request a key.' };
  }

  const raw = {
    name: (formData.get('name') ?? '').toString().trim(),
    description: (formData.get('description') ?? '').toString().trim(),
  };
  const parsed = RequestKeySchema.safeParse({
    name: raw.name,
    description: raw.description === '' ? undefined : raw.description,
  });
  if (!parsed.success) {
    const fieldErrors: RequestKeyState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'name') fieldErrors.name = issue.message;
      else if (path === 'description') fieldErrors.description = issue.message;
    }
    return { status: 'invalid', fieldErrors };
  }

  // Block stacking pending requests — one at a time per user.
  const existingPending = await prisma.apiKey.count({
    where: { userId: session.id, status: 'pending' },
  });
  if (existingPending > 0) {
    return {
      status: 'invalid',
      fieldErrors: { name: 'You already have a pending request. Wait for it to be reviewed.' },
    };
  }

  const { hash } = generateUserApiKey();
  let created;
  try {
    created = await prisma.apiKey.create({
      data: {
        userId: session.id,
        name: parsed.data.name,
        keyPrefix: 'ghc_usr_', // overwritten below
        keyHash: hash,
        status: 'pending',
      },
    });
    // Patch the prefix column to the actual first 4 hex chars. This is
    // a 2-step write because generateUserApiKey's prefix isn't known
    // until after the row's hash is in place; the unique constraint on
    // hash means we can't re-insert.
    await prisma.apiKey.update({
      where: { id: created.id },
      data: {
        keyPrefix: 'ghc_usr_' + hash.slice(0, 4),
      },
    });
  } catch (e: unknown) {
    logger.error({ err: e, userId: session.id.toString() }, 'request key insert failed');
    return { status: 'error', message: 'Could not create the request. Please try again.' };
  }

  await writeAudit({
    action: 'request_key_self',
    targetType: 'api_key',
    targetId: created.id.toString(),
    actorUserId: session.id,
    metadata: {
      name: parsed.data.name,
      ...(parsed.data.description ? { description: parsed.data.description } : {}),
    },
    ip,
  });

  // Best-effort admin notification.
  try {
    await sendKeyRequestedEmail({
      apiKey: created,
      requester: session,
      origin: getRequestOrigin(headersList),
    });
  } catch (e: unknown) {
    logger.warn({ err: e, keyId: created.id.toString() }, 'request key admin email failed');
  }

  redirect('/account/keys?requested=1');
}
