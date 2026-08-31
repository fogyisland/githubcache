import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * M17 — Static instruction card pointing operators at `npx prisma
 * studio`. We don't run the subprocess for them because Studio wants
 * a long-lived TTY and would tie up the request thread.
 */
export async function PrismaStudioLink(): Promise<ReactElement> {
  const t = await getTranslations('admin.database.prismaStudio');
  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>
      <p>{t('description')}</p>
      <pre className="ghc-admin-code-block">
        <code>{t('command')}</code>
      </pre>
      <p>
        <a
          className="ghc-link"
          href="https://www.prisma.io/docs/orm/tools/prisma-studio"
          target="_blank"
          rel="noreferrer"
        >
          {t('openDocs')}
        </a>
      </p>
    </section>
  );
}
