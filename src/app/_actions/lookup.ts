'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { lookupRepo, type QueryResult } from '@/lib/cache/lookup';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-bucket';
import { clientIpFromHeaders } from '@/lib/http/client-ip';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';

const OwnerSchema = z
  .string()
  .min(1, 'owner is required')
  .max(100, 'owner too long')
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, 'invalid owner format');

const NameSchema = z
  .string()
  .min(1, 'name is required')
  .max(200, 'name too long')
  .regex(/^[A-Za-z0-9._-]+$/, 'invalid name format');

export interface LookupFormState {
  status: 'idle' | 'ok' | 'rate_limited' | 'invalid' | 'error';
  message?: string;
  retryAfterSeconds?: number;
  result?: QueryResult;
}

function ownerErrorKey(issue: z.ZodIssue): 'ownerRequired' | 'ownerTooLong' | 'ownerFormat' | 'ownerInvalid' {
  if (issue.code === 'too_small') return 'ownerRequired';
  if (issue.code === 'too_big') return 'ownerTooLong';
  if (issue.code === 'invalid_format') return 'ownerFormat';
  return 'ownerInvalid';
}

function nameErrorKey(issue: z.ZodIssue): 'nameRequired' | 'nameTooLong' | 'nameFormat' | 'nameInvalid' {
  if (issue.code === 'too_small') return 'nameRequired';
  if (issue.code === 'too_big') return 'nameTooLong';
  if (issue.code === 'invalid_format') return 'nameFormat';
  return 'nameInvalid';
}

/**
 * Server action invoked from the public homepage form (/) and the
 * /repo/[owner]/[name] lookup controls. Validates input, enforces the
 * per-IP rate limit (PUBLIC_LOOKUP_RATE_PER_MIN, default 30), runs
 * lookupRepo, and returns the result.
 *
 * Rate-limited: callers should refresh-after-cooldown; we surface
 * retryAfterSeconds in the form state.
 */
export async function lookupAction(
  _prev: LookupFormState,
  formData: FormData,
): Promise<LookupFormState> {
  const t = await getTranslations('home.lookup.errors');

  // 1. Validate
  const parsedOwner = OwnerSchema.safeParse(formData.get('owner'));
  if (!parsedOwner.success) {
    return {
      status: 'invalid',
      message: t(ownerErrorKey(parsedOwner.error.issues[0]!)),
    };
  }
  const parsedName = NameSchema.safeParse(formData.get('name'));
  if (!parsedName.success) {
    return {
      status: 'invalid',
      message: t(nameErrorKey(parsedName.error.issues[0]!)),
    };
  }
  const owner = parsedOwner.data;
  const name = parsedName.data;

  // 2. Per-IP rate limit
  let hdrs: Headers;
  try {
    hdrs = await headers();
  } catch {
    hdrs = new Headers();
  }
  const ip = clientIpFromHeaders(hdrs);
  const rl = await checkIpRateLimit(ip, env.PUBLIC_LOOKUP_RATE_PER_MIN);
  if (!rl.allowed) {
    logger.warn(
      { ip, owner, name, retryAfter: rl.retryAfterSeconds },
      'public lookup rate-limited',
    );
    return {
      status: 'rate_limited',
      retryAfterSeconds: rl.retryAfterSeconds,
      message: t('rateLimited', { seconds: rl.retryAfterSeconds }),
    };
  }

  // 3. Lookup
  try {
    const result = await lookupRepo(owner, name);
    // Only revalidate on a successful cache write that affects the
    // recent-lookups list. /repo/[owner]/[name] page is dynamic anyway.
    if (result.fetch_status === 'ok') {
      revalidatePath('/');
    }
    return { status: 'ok', result };
  } catch (e: unknown) {
    logger.error({ err: e, ip, owner, name }, 'public lookup failed');
    return { status: 'error', message: t('generic') };
  }
}
