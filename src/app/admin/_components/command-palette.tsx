'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
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

export interface IndexedPaletteItem {
  kind: 'detail';
  label: string;
  href: string;
}

export interface PaletteData {
  sections: PaletteSection[];
  recentAudit: PaletteAuditEntry[];
  indexed: IndexedPaletteItem[];
}

export type PaletteHit =
  | { kind: 'section'; slug: string; title: string; href: string; icon: string }
  | { kind: 'audit'; id: string; action: string; actor: string | null; createdAt: string }
  | { kind: 'detail'; label: string; href: string };

/**
 * Pure search helper for the command palette. Given a query string,
 * returns the ranked hits across sections / detail entries / recent
 * audit. Exported for unit testing — see
 * `tests/unit/command-palette-v2.test.tsx`.
 *
 *  - Empty query → return top 5 sections, top 5 indexed, top 5 audit
 *    so the palette has useful "default" content the moment it opens.
 *  - Non-empty query → lowercase substring match against each group's
 *    label/title/action/actor. Sections checked against both title
 *    AND slug so "user" matches the Users section even with no
 *    description text. Detail entries are matched against their
 *    pre-rendered label (e.g. "User #42 — alice@example.com") so
 *    both "user 42" and "alice" resolve.
 *
 * Returned hits are NOT deep-equal to the input shapes — they're a
 * discriminated union that drops fields the renderer doesn't need
 * (e.g. icon for audit entries). The component reads `kind` and
 * narrows.
 */
export function matchPaletteQuery(
  q: string,
  sections: PaletteSection[],
  audit: PaletteAuditEntry[],
  indexed: IndexedPaletteItem[],
): PaletteHit[] {
  const query = q.trim().toLowerCase();
  if (!query) {
    return [
      ...sections.map((s) => ({
        kind: 'section' as const,
        slug: s.slug,
        title: s.title,
        href: s.href,
        icon: s.icon,
      })),
      ...indexed.slice(0, 5).map((d) => ({ kind: 'detail' as const, label: d.label, href: d.href })),
      ...audit.slice(0, 5).map((a) => ({
        kind: 'audit' as const,
        id: a.id,
        action: a.action,
        actor: a.actor,
        createdAt: a.createdAt,
      })),
    ];
  }
  // Normalize for matching: lowercase, strip "#", and collapse
  // whitespace so queries like "user 42" match labels like
  // "User #42 — alice@…" (otherwise the "#" between "user" and
  // "42" breaks the substring check, and the case difference
  // between "User" and "user" kills the match). Whitespace
  // collapse lets "audit  log" still match a single-spaced label.
  const normalize = (s: string): string =>
    s.toLowerCase().replace(/#/g, '').replace(/\s+/g, ' ').trim();
  const normQuery = normalize(query);

  const sectionHits = sections.filter(
    (s) =>
      normalize(s.title).includes(normQuery) ||
      s.slug.toLowerCase().includes(query),
  );
  const detailHits = indexed.filter((d) => normalize(d.label).includes(normQuery));
  const auditHits = audit.filter(
    (a) =>
      a.action.toLowerCase().includes(query) ||
      (a.actor ?? '').toLowerCase().includes(query),
  );
  return [
    ...sectionHits.map((s) => ({
      kind: 'section' as const,
      slug: s.slug,
      title: s.title,
      href: s.href,
      icon: s.icon,
    })),
    ...detailHits.map((d) => ({ kind: 'detail' as const, label: d.label, href: d.href })),
    ...auditHits.map((a) => ({
      kind: 'audit' as const,
      id: a.id,
      action: a.action,
      actor: a.actor,
      createdAt: a.createdAt,
    })),
  ];
}

/**
 * ⌘K command palette. Mounts a hidden `<dialog>` that's opened via the
 * `openPalette()` global window event (dispatched by ⌘K/Ctrl+K handler
 * registered in a `useEffect`). Uses native `<dialog>` to avoid pulling a
 * modal library.
 *
 * M30 — Task 2: lazy-fetches `/api/admin/palette` on first open via a
 * one-shot `ghc:open-palette` event listener (so the network round-trip
 * waits for the user, not for first paint). Uses `useRouter` for
 * soft-navigation so the sidebar highlight from Task 1 follows
 * immediately. Renders three groups (sections / details / audit) and
 * adds `data-testid="ghc-admin-palette-detail"` on detail rows for the
 * future Playwright test.
 *
 * No `data` prop — the layout mounts this component once at root
 * without passing anything in. Props interface is empty.
 */
export function CommandPalette(_props: Record<string, never> = {}): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [data, setData] = useState<PaletteData | null>(null);

  const t = useTranslations('admin.shell.palette');

  // Lazy-fetch palette data the first time the palette opens. Using a
  // one-shot `ghc:open-palette` event listener (rather than fetch on
  // mount) means the SSR layout doesn't pay for palette data on every
  // admin page render — the round-trip happens only when the user
  // presses ⌘K. `setData` writes the JSON payload into state, which
  // re-renders the dialog with the now-populated hits.
  useEffect(() => {
    if (data !== null) return;
    const open = async (): Promise<void> => {
      const res = await fetch('/api/admin/palette');
      if (res.ok) setData((await res.json()) as PaletteData);
    };
    window.addEventListener('ghc:open-palette', open, { once: true });
    return () => window.removeEventListener('ghc:open-palette', open);
  }, [data]);

  // Listen for the global open event + Ctrl/Cmd+K. Fires the
  // `ghc:open-palette` event first (which is what the lazy-fetch
  // listener above keys on), so a single keystroke kicks off the
  // fetch and the dialog open together.
  useEffect(() => {
    const open = (): void => {
      window.dispatchEvent(new Event('ghc:open-palette'));
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

  const allHits: PaletteHit[] = data
    ? matchPaletteQuery(query, data.sections, data.recentAudit, data.indexed)
    : [];

  // Reset highlight synchronously when query changes — no effect needed;
  // doing it in an effect triggers react-hooks/set-state-in-effect.
  function onQueryChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(e.target.value);
    setHighlight(0);
  }

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
      if (!target) return;
      dialogRef.current?.close();
      // Soft-navigate via useRouter (not window.location) so the
      // sidebar highlight from Task 1 follows immediately. Audit hits
      // are read-only info rows — no navigation.
      if (target.kind === 'section' || target.kind === 'detail') {
        router.push(target.href);
      }
    }
  }

  const sectionHits = allHits.filter((h): h is Extract<PaletteHit, { kind: 'section' }> => h.kind === 'section');
  const detailHits = allHits.filter((h): h is Extract<PaletteHit, { kind: 'detail' }> => h.kind === 'detail');
  const auditHits = allHits.filter((h): h is Extract<PaletteHit, { kind: 'audit' }> => h.kind === 'audit');

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
            onChange={onQueryChange}
            onKeyDown={onInputKeyDown}
            className="ghc-admin-palette-input"
          />
        </label>

        {data === null ? (
          <div className="ghc-admin-palette-empty">{t('loading', { defaultValue: 'Loading…' })}</div>
        ) : allHits.length === 0 ? (
          <div className="ghc-admin-palette-empty">
            <div>{t('noMatches', { query })}</div>
            <div className="ghc-admin-palette-empty-hint">{t('tryExamples')}</div>
          </div>
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

            {detailHits.length > 0 ? (
              <div className="ghc-admin-palette-group">
                <div className="ghc-admin-palette-group-label">{t('detailsHeading')}</div>
                <ul className="ghc-admin-palette-list">
                  {detailHits.map((d, i) => {
                    const idx = sectionHits.length + i;
                    const isActive = idx === highlight;
                    return (
                      <li key={d.href} className="ghc-admin-palette-item">
                        <Link
                          href={d.href}
                          data-testid="ghc-admin-palette-detail"
                          aria-label={t('goToDetail', { label: d.label })}
                          className={
                            isActive
                              ? 'ghc-admin-palette-hit ghc-admin-palette-hit-active'
                              : 'ghc-admin-palette-hit'
                          }
                          onClick={() => dialogRef.current?.close()}
                        >
                          <span className="ghc-admin-palette-icon" aria-hidden="true">
                            →
                          </span>
                          <span className="ghc-admin-palette-title">{d.label}</span>
                          <span className="ghc-admin-palette-href">{d.href}</span>
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
                    const idx = sectionHits.length + detailHits.length + i;
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

            {detailHits.length === 0 && auditHits.length === 0 && data.recentAudit.length === 0 ? (
              <div className="ghc-admin-palette-empty">{t('recentAuditEmpty')}</div>
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
