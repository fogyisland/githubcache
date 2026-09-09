import Link from 'next/link';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * M28 — secondary nav strip for /admin/database/* sub-pages.
 *
 * Sits below the breadcrumb and above the page header on every
 * database sub-page. Renders as a horizontal pill bar with three
 * slots (overview / schema / operations). The active slot is
 * inferred from the current `pathname` so the component is
 * stateless — the layout can keep its `force-dynamic` directive
 * without the tabs needing their own router hook.
 *
 * Per Web Interface Guidelines: predictable navigation, deep-linkable
 * URLs, no client-side state for what is fundamentally a routing
 * concern.
 */
export async function AdminDatabaseTabs({
  pathname,
}: {
  pathname: string;
}): Promise<ReactElement> {
  const t = await getTranslations('admin.database');
  const slots = [
    { href: '/admin/database', key: 'tabs.overview', match: (p: string) => p === '/admin/database' || p === '/admin/database/' },
    { href: '/admin/database/schema', key: 'tabs.schema', match: (p: string) => p.startsWith('/admin/database/schema') },
    { href: '/admin/database/operations', key: 'tabs.operations', match: (p: string) => p.startsWith('/admin/database/operations') },
  ];
  return (
    <nav className="ghc-admin-database-tabs" aria-label={t('tabs.label')}>
      {slots.map((s) => {
        const active = s.match(pathname);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={
              active
                ? 'ghc-admin-database-tab ghc-admin-database-tab-active'
                : 'ghc-admin-database-tab'
            }
            aria-current={active ? 'page' : undefined}
          >
            {t(s.key)}
          </Link>
        );
      })}
    </nav>
  );
}