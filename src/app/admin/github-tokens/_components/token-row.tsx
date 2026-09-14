import type { ReactElement } from 'react';
import { formatDate } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';
import { AdminTokenTestButton } from '@/app/admin/_components/admin-token-test-button';
import { TokenActions } from './token-actions';

/**
 * Shape consumed by `TokenRow`. Mirrors the columns we actually render —
 * wider than the `GithubToken` Prisma type (which also carries `tokenHash`,
 * `resetAt`, `createdAt`) so that callers can pass in pre-projected shapes
 * from server components without dragging the full DB row.
 */
export interface TokenRowData {
  id: bigint;
  label: string;
  tokenFirst4: string;
  tokenLast4: string;
  status: 'active' | 'disabled';
  requestsUsed: number;
  requestsLimit: number;
  lastUsedAt: Date | null;
}

interface Props {
  token: TokenRowData;
  userTz: TimezoneId;
  t: (key: string) => string;
}

/**
 * M32 — One GitHub-token record rendered as a flex-grid row inside the
 * terminal frame. Layout (status dot · status label · label · prefix ·
 * usage · last-used · test · actions) is driven by `ghc-term-row` in
 * globals.css. The `t` prop is injected by the caller (server-side
 * `getTranslations` or a stub in tests) — keeping `TokenRow` itself
 * rendering-only so `renderToStaticMarkup` works without an `I18nProvider`.
 *
 * Visual choice: when `lastUsedAt` is null we render an em-dash (`—`) —
 * NOT the i18n `list.never` ("never" / "从未") — to preserve the
 * terminal-record aesthetic where an empty field reads as a blank cell
 * rather than a localized word.
 */
export function TokenRow({ token, userTz, t }: Props): ReactElement {
  const isActive = token.status === 'active';
  const dot = isActive ? '●' : '○';
  const dotClass = isActive ? 'ghc-term-ok' : 'ghc-term-warn';
  const statusLabel = isActive ? t('status.active') : t('status.disabled');

  const pct =
    token.requestsLimit > 0
      ? Math.round((token.requestsUsed / token.requestsLimit) * 100)
      : 0;

  const lastUsedLabel = token.lastUsedAt ? formatDate(token.lastUsedAt, userTz) : '—';

  return (
    <div className="ghc-term-row" role="row" aria-label={token.label}>
      <span className={`ghc-term-row-dot ${dotClass}`} aria-hidden="true">
        {dot}
      </span>
      <span
        className="ghc-term-row-status ghc-term-dim"
        aria-label={t('list.column.status')}
      >
        {statusLabel.toUpperCase()}
      </span>
      <span className="ghc-term-row-label">{token.label}</span>
      <span className="ghc-term-row-prefix ghc-term-dim">
        {token.tokenFirst4}…{token.tokenLast4}
      </span>
      <span className="ghc-term-row-usage">
        {token.requestsUsed.toLocaleString()} / {token.requestsLimit.toLocaleString()}
        <span className="ghc-term-dim"> ({pct}%)</span>
      </span>
      <span className="ghc-term-row-last ghc-term-dim">{lastUsedLabel}</span>
      <span className="ghc-term-row-test">
        <AdminTokenTestButton tokenId={token.id.toString()} />
      </span>
      <span className="ghc-term-row-actions">
        <TokenActions tokenId={token.id.toString()} currentStatus={token.status} />
      </span>
    </div>
  );
}
