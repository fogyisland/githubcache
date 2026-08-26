import type { ReactElement } from 'react';
import Link from 'next/link';
import packageJson from '../../../package.json';

const VERSION = packageJson.version;

/**
 * 3-column site footer: brand+tagline / version+source / status+admin.
 * Reads version from package.json at build time (Next.js inlines it).
 */
export function SiteFooter(): ReactElement {
  return (
    <footer className="ghc-site-footer" data-testid="ghc-site-footer">
      <div className="ghc-site-footer-grid">
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-brand">GitHub Metadata Cache</p>
          <p className="ghc-site-footer-tagline">
            An open cache for GitHub repo metadata. Self-hostable.
          </p>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">Source</p>
          <ul className="ghc-site-footer-list">
            <li>
              <span className="ghc-site-footer-label">Version</span>{' '}
              <code>{VERSION}</code>
            </li>
            <li>
              <a
                href="https://github.com/anthropic-experimental/githubcache"
                className="ghc-link"
              >
                GitHub repo →
              </a>
            </li>
          </ul>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">Operations</p>
          <ul className="ghc-site-footer-list">
            <li>
              <Link href="/api/v1/status" className="ghc-link">
                Status JSON →
              </Link>
            </li>
            <li>
              <Link href="/login" className="ghc-link">
                Admin login →
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="ghc-site-footer-fine">
        © {new Date().getUTCFullYear()} · Built with Next.js + Prisma + MySQL.
      </p>
    </footer>
  );
}