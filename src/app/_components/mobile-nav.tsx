'use client';

import Link from 'next/link';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

interface NavLink {
  href: string;
  label: string;
  ariaLabel?: string;
}

interface Props {
  links: NavLink[];
  accountLabel: string;
  accountHref: string;
  loggedInLabel: string;
}

/**
 * Hamburger menu for screens < 1024px. Drawer-style overlay.
 * Server side renders nothing (returns null) when the layout is
 * hidden via CSS — hamburger is mobile-only via @media.
 */
export function MobileNav({ links, accountLabel, accountHref, loggedInLabel }: Props): JSX.Element {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="ghc-hamburger"
        aria-label={t('mobileMenuAria')}
        aria-expanded={open}
        aria-controls="ghc-mobile-nav-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open ? (
        <div
          className="ghc-mobile-nav-drawer"
          id="ghc-mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('mobileMenuAria')}
        >
          <nav className="ghc-mobile-nav-links">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="ghc-mobile-nav-link"
                aria-label={l.ariaLabel}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href={accountHref}
              className="ghc-mobile-nav-link"
              onClick={() => setOpen(false)}
            >
              {accountLabel}
            </Link>
          </nav>
        </div>
      ) : null}
    </>
  );
}
