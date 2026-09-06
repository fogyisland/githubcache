import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEmailConfig, publicConfigForUi } from '@/lib/email/config';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { EmailConfigForm } from './_components/email-config-form';
import { TestSendButton } from './_components/test-send-button';

const DEFAULT_PORT = 587;
const DEFAULT_USER = '';
const DEFAULT_FROM = '';

/**
 * M25 — admin Email config page.
 *
 * Server component. Loads the singleton email_config row, renders:
 *  - Page header + description
 *  - "Not configured" hint when no row exists
 *  - EmailConfigForm (host / port / user / pass / secure / from / replyTo)
 *  - "Send test" button (POSTs to /api/admin/email/test)
 *  - "View log →" link to /admin/email/log
 *
 * The form is a client component that drives the server action in
 * `_actions/save-config.ts`. The CSRF token is read from the
 * `ghc_csrf` cookie via cookies() — same source as other admin forms.
 */
export default async function AdminEmailPage(): Promise<ReactElement> {
  const t = await getTranslations('admin.email');

  // Layout already gates auth; resolve CSRF + session id for the form.
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

  const cfg = await getEmailConfig();
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

      {!safe.configured ? (
        <p className="ghc-admin-hint">{t('notConfigured')}</p>
      ) : null}

      <section>
        <h2 className="ghc-admin-section-title">{t('form.heading')}</h2>
        <EmailConfigForm initial={initial} csrfToken={csrfToken} />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">{t('test.heading')}</h2>
        <p className="ghc-admin-hint">{t('toHelp', { email: user?.email ?? '?' })}</p>
        <TestSendButton csrfToken={csrfToken} />
      </section>

      <p style={{ marginTop: 32 }}>
        <Link href="/admin/email/log" className="ghc-link">
          {t('viewLog')}
        </Link>
      </p>
    </div>
  );
}
