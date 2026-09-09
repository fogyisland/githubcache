'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { getEmailConfig } from '@/lib/email/config';
import { createTransport } from '@/lib/email/transport';
import { verifyCsrf } from '@/lib/auth/csrf';

export interface TestConnectionState {
  status: 'idle' | 'ok' | 'failed';
  message?: string;
  latencyMs?: number;
}

/**
 * Server action — SMTP handshake test (no email sent).
 *
 * nodemailer's `transporter.verify()` opens a TCP connection to the
 * SMTP host, optionally STARTTLS, and authenticates — all without
 * sending any message. Lets the operator confirm credentials are
 * correct in <2s without putting test mail in anyone's inbox.
 *
 * Returns the wall-clock latency so the UI can show "connected in
 * 87ms" / "timed out after 5000ms" etc.
 */
export async function testEmailConnection(
  _prev: TestConnectionState,
  formData: FormData,
): Promise<TestConnectionState> {
  const csrf = String(formData.get('csrf') ?? '');
  const headerToken = (await cookies()).get('ghc_csrf')?.value ?? null;
  if (!verifyCsrf({ headers: new Headers({ 'x-csrf-token': headerToken ?? '' }) } as never, csrf)) {
    return { status: 'failed', message: 'csrf' };
  }

  const cfg = await getEmailConfig();
  if (!cfg.configured || !cfg.row) {
    return { status: 'failed', message: 'not_configured' };
  }

  const t0 = Date.now();
  try {
    const transporter = createTransport(cfg.row);
    await transporter.verify();
    const latencyMs = Date.now() - t0;
    logger.info({ latencyMs }, 'admin: smtp test connection ok');
    revalidatePath('/admin/email');
    return { status: 'ok', latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const message = (e as Error).message;
    logger.warn({ latencyMs, message }, 'admin: smtp test connection failed');
    return { status: 'failed', message, latencyMs };
  }
}
