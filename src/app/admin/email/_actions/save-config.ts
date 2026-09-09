'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/client';
import { validateSession } from '@/lib/auth/session';
import { cookiesFromRequest } from '@/lib/auth/cookies-from-request';
import { verifyCsrf } from '@/lib/auth/csrf';
import { writeAudit } from '@/lib/audit/writer';

export interface SaveEmailConfigState {
  status: 'idle' | 'ok' | 'invalid' | 'forbidden' | 'error';
  message?: string;
  fieldsChanged?: string[];
}

/**
 * zod schema for a save submission. `smtp_pass` is optional in the
 * UPDATE path so the operator can leave it blank to keep the existing
 * value (matches the placeholder "(unchanged)" shown in the UI).
 */
const SaveSchema = z.object({
  smtpHost: z.string().trim().min(1, 'host required').max(255),
  smtpPort: z.coerce.number().int().positive().max(65535),
  smtpUser: z.string().trim().min(1, 'user required').max(255),
  smtpPass: z.string().max(1024).optional().default(''),
  smtpSecure: z.union([z.literal('on'), z.literal('off'), z.literal('true'), z.literal('false'), z.boolean()]).optional(),
  smtpFrom: z.string().trim().min(1, 'from required').max(255),
  replyTo: z.string().trim().max(255).optional().default(''),
});

function parseBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'on' || v === 'true' || v === '1') return true;
  return false;
}

/**
 * M25 — server action that saves the singleton email_config row.
 *
 * - Admin only (CSRF checked as defense-in-depth).
 * - Upserts row id=1 (CHECK constraint enforces single-row).
 * - Empty `smtpPass` on update → preserve the existing password
 *   (placeholder semantics). On INSERT, smtpPass is required.
 * - Audit metadata lists fieldsChanged but NEVER includes smtpPass.
 */
export async function saveEmailConfigAction(
  _prev: SaveEmailConfigState,
  formData: FormData,
): Promise<SaveEmailConfigState> {
  // Auth — admin only
  const reqHeaders = await headers();
  const cookieHeader = reqHeaders.get('cookie') ?? '';
  const fwd = reqHeaders.get('x-forwarded-for') ?? undefined;
  const csrf = formData.get('csrf');
  if (typeof csrf === 'string' && csrf !== '') {
    if (!verifyCsrf({ headers: reqHeaders }, csrf)) {
      return { status: 'forbidden', message: 'invalid csrf' };
    }
  }
  const user = await validateSession({
    headers: reqHeaders,
    cookies: cookiesFromRequest(new Request('http://x', { headers: new Headers([['cookie', cookieHeader]]) })),
  });
  if (!user || user.role !== 'admin') {
    return { status: 'forbidden', message: 'forbidden' };
  }

  const parsed = SaveSchema.safeParse({
    smtpHost: formData.get('smtp_host'),
    smtpPort: formData.get('smtp_port'),
    smtpUser: formData.get('smtp_user'),
    smtpPass: formData.get('smtp_pass') ?? '',
    smtpSecure: formData.get('smtp_secure') ?? 'off',
    smtpFrom: formData.get('smtp_from'),
    replyTo: formData.get('reply_to') ?? '',
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: 'invalid',
      message: first ? `${first.path.join('.')}: ${first.message}` : 'invalid input',
    };
  }

  const data = parsed.data;
  const replyTo = data.replyTo && data.replyTo.length > 0 ? data.replyTo : null;
  const secure = parseBool(data.smtpSecure);

  // Find existing row to decide INSERT vs UPDATE semantics for smtp_pass
  const existing = await prisma.emailConfig.findUnique({ where: { id: 1 } });

  // On insert, password is required.
  if (!existing && (!data.smtpPass || data.smtpPass.length === 0)) {
    return { status: 'invalid', message: 'smtp_pass: required on first save' };
  }

  // Determine fieldsChanged for the audit row. Excludes smtp_pass.
  const fieldsChanged: string[] = [];
  if (!existing) {
    fieldsChanged.push('created');
  } else {
    if (existing.smtpHost !== data.smtpHost) fieldsChanged.push('smtp_host');
    if (existing.smtpPort !== data.smtpPort) fieldsChanged.push('smtp_port');
    if (existing.smtpUser !== data.smtpUser) fieldsChanged.push('smtp_user');
    if (data.smtpPass && data.smtpPass.length > 0) fieldsChanged.push('smtp_pass');
    if (existing.smtpSecure !== secure) fieldsChanged.push('smtp_secure');
    if (existing.smtpFrom !== data.smtpFrom) fieldsChanged.push('smtp_from');
    if ((existing.replyTo ?? '') !== (replyTo ?? '')) fieldsChanged.push('reply_to');
  }

  await prisma.emailConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      smtpHost: data.smtpHost,
      smtpPort: data.smtpPort,
      smtpUser: data.smtpUser,
      smtpPass: data.smtpPass && data.smtpPass.length > 0 ? data.smtpPass : '',
      smtpSecure: secure,
      smtpFrom: data.smtpFrom,
      replyTo,
      updatedBy: user.id,
    },
    update: {
      smtpHost: data.smtpHost,
      smtpPort: data.smtpPort,
      smtpUser: data.smtpUser,
      ...(data.smtpPass && data.smtpPass.length > 0 ? { smtpPass: data.smtpPass } : {}),
      smtpSecure: secure,
      smtpFrom: data.smtpFrom,
      replyTo,
      updatedBy: user.id,
    },
  });

  void writeAudit({
    action: 'save_email_config',
    targetType: 'email_config',
    targetId: '1',
    metadata: { fieldsChanged },
    actorUserId: user.id,
    ...(fwd ? { ip: fwd } : {}),
  });

  revalidatePath('/admin/email');
  return { status: 'ok', fieldsChanged };
}
