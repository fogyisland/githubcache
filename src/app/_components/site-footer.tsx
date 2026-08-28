import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import packageJson from '../../../package.json';

const VERSION = packageJson.version;

/**
 * 3-column site footer: brand+tagline / version+source / status+admin.
 * Reads version from package.json at build time (Next.js inlines it).
 *
 * Server component — pulls translated copy via `getTranslations`. Marked
 * async because `getTranslations` is async.
 */
export async function SiteFooter(): Promise<ReactElement> {
  const tNav = await getTranslations('nav');
  const tFoot = await getTranslations('footer');

  return (
    <footer className="ghc-site-footer" data-testid="ghc-site-footer">
      <div className="ghc-site-footer-grid">
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-brand">GitHub Metadata Cache</p>
          <p className="ghc-site-footer-tagline">{tFoot('tagline')}</p>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">{tFoot('source')}</p>
          <ul className="ghc-site-footer-list">
            <li>
              <span className="ghc-site-footer-label">{tFoot('version')}</span>{' '}
              <code>{VERSION}</code>
            </li>
            <li>
              <a href="https://github.com/anthropic-experimental/githubcache" className="ghc-link">
                {tFoot('repoLink')}
              </a>
            </li>
          </ul>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">{tFoot('operations')}</p>
          <ul className="ghc-site-footer-list">
            <li>
              <Link href="/api/v1/status" className="ghc-link">
                {tNav('status')}
              </Link>
            </li>
            <li>
              <Link href="/login" className="ghc-link">
                {tNav('admin')}
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="ghc-site-footer-fine">
        {tFoot('fine', { year: new Date().getUTCFullYear() })}
      </p>
    </footer>
  );
}
