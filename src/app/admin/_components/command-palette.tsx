'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

export interface PaletteSection {
  slug: string;
  title: string;
  icon: string;
  href: string;
}

export interface PaletteAuditEntry {
  id: string;
  action: string;
  actor: string | null;
  createdAt: string;
}

export interface PaletteData {
  sections: PaletteSection[];
  recentAudit: PaletteAuditEntry[];
}

interface Props {
  /** SSR-prefetched palette data (avoids fetch-on-open for first paint). */
  data: PaletteData;
  /** Optional initial query (test override). */
  query?: string;
}

/**
 * ⌘K command palette. Mounts a hidden `<dialog>` that's opened via the
 * `openPalette()` global window event (dispatched by ⌘K/Ctrl+K handler
 * registered in a `useEffect`). Uses native `<dialog>` to avoid pulling a
 * modal library. Search is a simple lowercase substring filter — fast
 * enough for the 7 sections + 5 audit entries returned by the palette API.
 */
export function CommandPalette({ data, query: initialQuery = '' }: Props): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(0);

  const t = useTranslations('admin.shell.palette');

  const { sectionHits, auditHits } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sectionHits = q
      ? data.sections.filter(
          (s) => s.title.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
        )
      : data.sections;
    const auditHits = q
      ? data.recentAudit.filter(
          (a) =>
            a.action.toLowerCase().includes(q) ||
            (a.actor ?? '').toLowerCase().includes(q),
        )
      : data.recentAudit;
    return { sectionHits, auditHits };
  }, [data, query]);

  const allHits = useMemo(
    () => [
      ...sectionHits.map((s) => ({ kind: 'section' as const, key: `s:${s.slug}`, ...s })),
      ...auditHits.map((a) => ({ kind: 'audit' as const, key: `a:${a.id}`, ...a })),
    ],
    [sectionHits, auditHits],
  );

  // Listen for the global open event + Ctrl/Cmd+K.
  useEffect(() => {
    const open = (): void => {
      dialogRef.current?.showModal();
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('ghc:open-palette', open);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('ghc:open-palette', open);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Reset highlight when results change.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(allHits.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = allHits[highlight];
      if (target?.kind === 'section') {
        dialogRef.current?.close();
        window.location.href = target.href;
      }
    }
  }

  return (
    <dialog ref={dialogRef} className="ghc-admin-palette-dialog">
      <div className="ghc-admin-palette-inner">
        <label htmlFor={inputId} className="ghc-admin-palette-label">
          <span aria-hidden="true">⌘K</span>
          <input
            id={inputId}
            ref={inputRef}
            type="search"
            placeholder={t('placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="ghc-admin-palette-input"
          />
        </label>

        {allHits.length === 0 ? (
          <div className="ghc-admin-palette-empty">{t('noMatches', { query })}</div>
        ) : (
          <div className="ghc-admin-palette-results">
            {sectionHits.length > 0 ? (
              <div className="ghc-admin-palette-group">
                <div className="ghc-admin-palette-group-label">{t('sections')}</div>
                <ul className="ghc-admin-palette-list">
                  {sectionHits.map((s, i) => {
                    const idx = i;
                    const isActive = idx === highlight;
                    return (
                      <li key={s.slug} className="ghc-admin-palette-item">
                        <Link
                          href={s.href}
                          className={
                            isActive
                              ? 'ghc-admin-palette-hit ghc-admin-palette-hit-active'
                              : 'ghc-admin-palette-hit'
                          }
                          onClick={() => dialogRef.current?.close()}
                        >
                          <span className="ghc-admin-palette-icon" aria-hidden="true">
                            {s.icon}
                          </span>
                          <span className="ghc-admin-palette-title">{s.title}</span>
                          <span className="ghc-admin-palette-href">{s.href}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {auditHits.length > 0 ? (
              <div className="ghc-admin-palette-group">
                <div className="ghc-admin-palette-group-label">{t('recentAudit')}</div>
                <ul className="ghc-admin-palette-list">
                  {auditHits.map((a, i) => {
                    const idx = sectionHits.length + i;
                    const isActive = idx === highlight;
                    return (
                      <li key={a.id} className="ghc-admin-palette-item">
                        <span
                          className={
                            isActive
                              ? 'ghc-admin-palette-hit ghc-admin-palette-hit-active'
                              : 'ghc-admin-palette-hit'
                          }
                        >
                          <span className="ghc-admin-palette-icon" aria-hidden="true">
                            ◭
                          </span>
                          <span className="ghc-admin-palette-title">{a.action}</span>
                          <span className="ghc-admin-palette-href">{a.actor ?? '—'}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <div className="ghc-admin-palette-hint">
          <kbd>↑↓</kbd> {t('hintNav')} · <kbd>↵</kbd> {t('hintOpen')} · <kbd>esc</kbd> {t('hintClose')}
        </div>
      </div>
    </dialog>
  );
}
