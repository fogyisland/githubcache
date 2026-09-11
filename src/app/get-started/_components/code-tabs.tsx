'use client';

import { useState, useCallback, useId, type ReactElement } from 'react';
import { CopyButton } from './copy-button';

export type CodeLang = 'curl' | 'python' | 'nodejs' | 'powershell';

export interface LangSnippet {
  lang: CodeLang;
  code: string;
}

interface Props {
  snippets: LangSnippet[];
  /** i18n map keyed by lang → label (e.g. { curl: 'curl', python: 'Python', ... }). */
  tabLabels: Record<CodeLang, string>;
  copyLabel: string;
  copiedLabel: string;
  /** Optional accessible label for the whole tablist (e.g. "GET /api/v1/status"). */
  ariaLabel?: string;
}

/**
 * Server passes all four language snippets in; the client only flips
 * `useState` to choose which one is visible. No fetch, no client-side
 * code generation — the Python/Node/PowerShell builders run on the
 * server at render time.
 */
export function CodeTabs(props: Props): ReactElement {
  const baseId = useId();
  const [active, setActive] = useState<CodeLang>(props.snippets[0]?.lang ?? 'curl');

  const onSelect = useCallback((lang: CodeLang): void => {
    setActive(lang);
  }, []);

  const current = props.snippets.find((s) => s.lang === active) ?? props.snippets[0];

  if (!current) {
    // Defensive: empty snippets array. Render nothing rather than crash.
    return <></>;
  }

  const tabId = (lang: CodeLang): string => `${baseId}-tab-${lang}`;
  const panelId = (lang: CodeLang): string => `${baseId}-panel-${lang}`;

  return (
    <div className="ghc-getstarted-code-tabs">
      <div
        role="tablist"
        aria-label={props.ariaLabel}
        className="ghc-getstarted-tablist"
      >
        {props.snippets.map((s) => {
          const isActive = s.lang === active;
          return (
            <button
              key={s.lang}
              type="button"
              role="tab"
              id={tabId(s.lang)}
              aria-selected={isActive}
              aria-controls={panelId(s.lang)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(s.lang)}
              className={`ghc-getstarted-tab${isActive ? ' ghc-getstarted-tab-active' : ''}`}
            >
              {props.tabLabels[s.lang]}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId(active)}
        aria-labelledby={tabId(active)}
        className="ghc-getstarted-code-panel"
      >
        <div className="ghc-getstarted-code-panel-meta">
          <span className="ghc-getstarted-code-lang">{props.tabLabels[active]}</span>
          <CopyButton
            text={current.code}
            label={props.copyLabel}
            copiedLabel={props.copiedLabel}
          />
        </div>
        <pre className="ghc-getstarted-curl">
          <code>{current.code}</code>
        </pre>
      </div>
    </div>
  );
}
