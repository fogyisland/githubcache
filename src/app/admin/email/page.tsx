import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { getEmailConfig, publicConfigForUi } from '@/lib/email/config';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { EmailConfigForm } from './_components/email-config-form';
import { TestSendButton } from './_components/test-send-button';
import { SmtpStatusCard } from './_components/smtp-status-card';
import { prisma } from '@/lib/db/client';

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_PORT = 587;
const DEFAULT_USER = '';
const DEFAULT_FROM = '';

/**
 * M25 → M28 — admin Email config page.
 *
 * Page layout (top → bottom):
 *   1. PageHeader
 *   2. SmtpStatusCard — configured status, 24h sent/failed counts,
 *      last-success timestamp, "Test connection" button
 *   3. [Optional] BinaryWarning if mysqldump / gzip missing
 *   4. EmailConfigForm — two visual sections ("Server" + "Identity")
 *      but a single submit (the SMTP config is one row)
 *   5. TestSendButton — sends a real test email to the current admin
 *   6. "View log →" link
 *
 * Admin-only because the page exposes SMTP credentials (password is
 * write-only — never returned to the UI).
 */
export default async function AdminEmailPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.email');

  const cookieStore = cookies();
  const csrfToken = cookieStore.get('ghc_csrf')?.value ?? '';

  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/admin');
  }

  const [cfg, sentLast24h, failedLast24h, lastSuccessRow] = await Promise.all([
    getEmailConfig(),
    prisma.emailLog.count({ where: { status: 'sent', createdAt: { gt: new Date(Date.now() - DAY_MS) } } }),
    prisma.emailLog.count({ where: { status: 'failed', createdAt: { gt: new Date(Date.now() - DAY_MS) } } }),
    prisma.emailLog.findFirst({
      where: { status: 'sent' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const safe = publicConfigForUi(cfg);

  const initial = cfg.configured && cfg.row
    ? {
        smtpHost: cfg.row.smtpHost,
        smtpPort: cfg.row.smtpPort,
        smtpUser: cfg.row.smtpUser,
        smtpFrom: cfg.row.smtpFrom,
        replyTo: cfg.row.replyTo,
        smtpSecure: cfg.row.smtpSecure,
        hasPassword: cfg.row.smtpPass.length > 0,
      }
    : {
        smtpHost: '',
        smtpPort: DEFAULT_PORT,
        smtpUser: DEFAULT_USER,
        smtpFrom: DEFAULT_FROM,
        replyTo: null,
        smtpSecure: false,
        hasPassword: false,
      };

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbEmail') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      <SmtpStatusCard
        configured={cfg.configured}
        totalLast24h={sentLast24h + failedLast24h}
        sentLast24h={sentLast24h}
        failedLast24h={failedLast24h}
        lastSuccessAt={lastSuccessRow?.createdAt.toISOString() ?? null}
      />

      <section>
        <h2 className="ghc-admin-section-title">{t('form.heading')}</h2>
        <div className="ghc-api-settings-card">
          <EmailConfigForm initial={initial} csrfToken={csrfToken} />
        </div>
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('test.heading')}</h2>
        <p className="ghc-admin-section-desc">{t('test.toHelp', { email: user?.email ?? '?' })}</p>
        <div className="ghc-api-settings-card">
          <TestSendButton csrfToken={csrfToken} />
        </div>
      </section>

      <p>
        <a href="/admin/email/log" className="ghc-link">
          {t('viewLog')}
        </a>
      </p>
    </div>
  );
}