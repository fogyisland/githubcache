'use client';

import { useRef, useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectMetadata } from '@/lib/version';

/**
 * M32.7.7-a — About button (admin utility bar)
 *
 * Single icon button in the top-right utility bar (between
 * `<AdminModeSwitcher>` and `<LogoutButton>`). Click opens a native
 * `<dialog>` that surfaces the project metadata (repo URL, author
 * name, version).
 *
 * Architecture note: this is a `'use client'` component but reads its
 * version/author/repo data via props (not by importing `package.json`
 * directly). The server-side `<AdminLayout>` reads `@/lib/version` and
 * passes the four strings down. Splitting it this way:
 *   1. Avoids pulling the entire package.json into the browser bundle.
 *   2. Makes the component trivially testable — pass any values, the
 *      dialog renders them. No JSON mocks needed.
 */
export interface AboutButtonProps {
  version: string;
  repoUrl: string;
  authorName: string;
  authorUrl: string;
}

export function AboutButton(props: AboutButtonProps): ReactElement {
  const t = useTranslations('admin.shell.about');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function handleOpen(): void {
    dialogRef.current?.showModal();
    setOpen(true);
  }
  function handleClose(): void {
    dialogRef.current?.close();
    setOpen(false);
  }

  const repoUrl = props.repoUrl;
  const authorName = props.authorName;
  const authorUrl = props.authorUrl;
  const version = props.version;

  return (
    <>
      <button
        type="button"
        className="ghc-admin-about-trigger ghc-mode-toggle"
        onClick={handleOpen}
        aria-label={t('triggerLabel')}
        title={t('triggerLabel')}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        className="ghc-admin-about-dialog"
        onClose={() => setOpen(false)}
        aria-hidden={!open}
      >
        <div className="ghc-admin-about-body">
          <h3 className="ghc-admin-about-title">{t('title')}</h3>

          <dl className="ghc-admin-about-fields">
            <div className="ghc-admin-about-field">
              <dt className="ghc-admin-about-label">{t('repoLabel')}</dt>
              <dd className="ghc-admin-about-value">
                <a
                  href={repoUrl}
                  className="ghc-link ghc-admin-about-repo-link"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {repoUrl.replace(/^https?:\/\//, '')}
                </a>
              </dd>
            </div>
            <div className="ghc-admin-about-field">
              <dt className="ghc-admin-about-label">{t('authorLabel')}</dt>
              <dd className="ghc-admin-about-value">
                <a
                  href={authorUrl}
                  className="ghc-link ghc-admin-about-author-link"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {authorName}
                </a>
              </dd>
            </div>
            <div className="ghc-admin-about-field">
              <dt className="ghc-admin-about-label">Version</dt>
              <dd className="ghc-admin-about-value ghc-admin-about-version">
                v{version}
              </dd>
            </div>
          </dl>

          <div className="ghc-admin-about-actions">
            <button
              type="button"
              className="ghc-btn-ghost ghc-admin-about-close"
              onClick={handleClose}
            >
              {t('close')}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * Convenience wrapper for the admin layout — pulls the build-time
 * metadata from `@/lib/version` and passes it down. Lives here so the
 * layout import surface stays tight (one symbol).
 */
export function AboutButtonWithBuildMetadata(
  props: Omit<AboutButtonProps, 'version' | 'repoUrl' | 'authorName' | 'authorUrl'> & {
    metadata: ProjectMetadata;
  },
): ReactElement {
  return (
    <AboutButton
      version={props.metadata.version}
      repoUrl={props.metadata.repoUrl}
      authorName={props.metadata.authorName}
      authorUrl={props.metadata.authorUrl}
    />
  );
}