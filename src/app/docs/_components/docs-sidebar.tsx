'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

export function DocsSidebar(): ReactElement {
  const pathname = usePathname();
  const t = useTranslations('docs.sidebar');
  return (
    <nav className="ghc-doc-sidebar" aria-label={t('ariaLabel')}>
      <h2 className="ghc-doc-sidebar-heading">{t('heading')}</h2>
      <ul className="ghc-doc-sidebar-list">
        <li>
          <Link
            href="/docs"
            className={pathname === '/docs' ? 'ghc-doc-sidebar-current' : ''}
          >
            {t('overview')}
          </Link>
        </li>
        {ENDPOINT_DOCS.map((doc) => {
          const href = `/docs/${doc.slug}`;
          const isCurrent = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={doc.slug}>
              <Link
                href={href}
                className={isCurrent ? 'ghc-doc-sidebar-current' : ''}
              >
                <span className={`ghc-doc-method ghc-doc-method-${doc.method}`}>
                  {doc.method}
                </span>
                <span className="ghc-doc-sidebar-path">{doc.path}</span>
              </Link>
            </li>
          );
        })}
        {/* Separator before the development section so users see it as
            a different category (operator / contributor docs vs API ref). */}
        <li className="ghc-doc-sidebar-separator" aria-hidden="true" />
        <li>
          <Link
            href="/docs/development"
            className={
              pathname === '/docs/development' || pathname.startsWith('/docs/development/')
                ? 'ghc-doc-sidebar-current'
                : ''
            }
          >
            <span className="ghc-doc-sidebar-icon" aria-hidden="true">⌘</span>
            <span className="ghc-doc-sidebar-path">{t('development')}</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
