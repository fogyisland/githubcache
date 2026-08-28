'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { ENDPOINT_DOCS } from '@/lib/api-docs/registry';

export function DocsSidebar(): ReactElement {
  const pathname = usePathname();
  return (
    <nav className="ghc-doc-sidebar" aria-label="Documentation sections">
      <h2 className="ghc-doc-sidebar-heading">API Reference</h2>
      <ul className="ghc-doc-sidebar-list">
        <li>
          <Link
            href="/docs"
            className={pathname === '/docs' ? 'ghc-doc-sidebar-current' : ''}
          >
            Overview
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
      </ul>
    </nav>
  );
}
