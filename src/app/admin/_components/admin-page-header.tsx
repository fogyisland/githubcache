import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactElement, ReactNode } from 'react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface Props {
  breadcrumb?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: ReactNode;
}

/**
 * Standard page header for admin pages.
 *
 * - Optional breadcrumb chain at the top (links rendered via next/link;
 *   the trailing item without an href is the current page).
 * - Title + optional description on the left.
 * - Actions slot on the right (buttons, filters, etc.).
 */
export async function AdminPageHeader({
  breadcrumb,
  title,
  description,
  actions,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.shell');
  return (
    <header className="ghc-admin-page-header">
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav className="ghc-admin-breadcrumb" aria-label={t('breadcrumbAria')}>
          {breadcrumb.map((item, i) => (
            <span key={`${item.label}-${i}`} className="ghc-admin-breadcrumb-item">
              {item.href ? (
                <Link href={item.href} className="ghc-link">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page">{item.label}</span>
              )}
              {i < breadcrumb.length - 1 ? (
                <span className="ghc-admin-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="ghc-admin-page-header-row">
        <div>
          <h1 className="ghc-admin-page-title">{title}</h1>
          {description ? <p className="ghc-admin-page-desc">{description}</p> : null}
        </div>
        {actions ? <div className="ghc-admin-page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
