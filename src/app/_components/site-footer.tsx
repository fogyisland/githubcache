import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import packageJson from '../../../package.json';
import { SITE_NAME } from '@/lib/config/site';
import { fetchStatusPing } from '@/lib/status/ping';

const VERSION = packageJson.version;

/**
 * Site footer: brand+tagline / nav links / live API status dot.
 * Reads version from package.json at build time (Next.js inlines it).
 *
 * Server component — fetches a small status snapshot for the live dot.
 */
export async function SiteFooter(): Promise<ReactElement> {
  const tNav = await getTranslations('nav');
  const tFoot = await getTranslations('footer');
  const ping = await fetchStatusPing();

  return (
    <footer className="ghc-site-footer" data-testid="ghc-site-footer">
      <div className="ghc-site-footer-grid">
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-brand">{SITE_NAME}</p>
          <p className="ghc-site-footer-tagline">{tFoot('tagline')}</p>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">{tFoot('explore')}</p>
          <ul className="ghc-site-footer-list">
            <li><Link href="/get-started" className="ghc-link">{tNav('apiGuide')}</Link></li>
            <li><Link href="/status" className="ghc-link">{tNav('status')}</Link></li>
            <li><Link href="/account" className="ghc-link">{tNav('account')}</Link></li>
            <li><Link href="/login" className="ghc-link">{tNav('login')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="ghc-site-footer-fine">
        <span>© {new Date().getUTCFullYear()} {SITE_NAME}</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span>MIT</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span>v{VERSION}</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <a
          href="https://github.com/fogyisland/githubcache"
          className="ghc-link"
          target="_blank"
          rel="noreferrer noopener"
        >
          GitHub
        </a>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span className="ghc-site-footer-status">
          <span
            className="ghc-status-dot"
            data-state={ping.ok ? 'ok' : 'fail'}
            aria-hidden="true"
          />
          {ping.ok ? tFoot('statusOk') : tFoot('statusDown')}
          <span className="sr-only">{ping.ok ? tFoot('statusOkSr') : tFoot('statusDownSr')}</span>
        </span>
      </div>
    </footer>
  );
}
