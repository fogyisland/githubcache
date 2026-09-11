'use client';

import Link from 'next/link';
import { useState, useRef, useEffect, type JSX } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  email: string;
  isAdmin: boolean;
  logoutHref: string;
}

/**
 * Avatar + email-initial trigger; dropdown shows account links + logout.
 * Closes on outside click + Escape key.
 */
export function AccountMenu({ email, isAdmin, logoutHref }: Props): JSX.Element {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = email.charAt(0).toUpperCase() || '?';

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }
  }, [open]);

  return (
    <div className="ghc-account-menu" ref={ref}>
      <button
        type="button"
        className="ghc-account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('accountMenuAria', { email })}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ghc-account-avatar" aria-hidden="true">{initial}</span>
      </button>
      {open ? (
        <div className="ghc-account-menu-dropdown" role="menu">
          <Link href="/account" className="ghc-account-menu-item" role="menuitem">
            {t('account')}
          </Link>
          <Link href="/account/keys" className="ghc-account-menu-item" role="menuitem">
            {t('apiKeys')}
          </Link>
          {isAdmin ? (
            <Link href="/admin" className="ghc-account-menu-item" role="menuitem">
              {t('admin')}
            </Link>
          ) : null}
          <Link href="/account/preferences" className="ghc-account-menu-item" role="menuitem">
            {t('preferences')}
          </Link>
          <hr className="ghc-account-menu-sep" />
          <a href={logoutHref} className="ghc-account-menu-item ghc-account-menu-logout" role="menuitem">
            {t('logout')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
