'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { runMigrationsAction } from '../_actions/run-migrations';

export interface MigrationRow {
  name: string;
  timestamp: string;
  slug: string;
  applied: boolean;
  finishedAt: string | null;
}

interface Props {
  initialMigrations: MigrationRow[];
}

/**
 * M28.bug25 — schema upgrade panel.
 *
 * Lists every migration in prisma/migrations/ with applied/pending state,
 * and exposes a "Run migrate deploy" button. After a successful run
 * the page reloads so the user sees the freshly-applied rows in green.
 */
export function SchemaUpgrade({ initialMigrations }: Props): React.ReactElement {
  const t = useTranslations('admin.database.upgrade');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pendingCount = initialMigrations.filter((m) => !m.applied).length;
  const appliedCount = initialMigrations.filter((m) => m.applied).length;
  const allApplied = pendingCount === 0;

  function onUpgrade() {
    setError(null);
    startTransition(async () => {
      const r = await runMigrationsAction();
      if (!r.ok) {
        setError(r.error ?? 'migrate deploy failed');
        return;
      }
      // Re-render the page with fresh migration status from the DB.
      router.refresh();
    });
  }

  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>
      <p className="ghc-admin-section-desc">{t('description')}</p>

      <div className="ghc-upgrade-summary" data-empty={allApplied ? 'true' : 'false'}>
        {allApplied ? (
          <span>{t('allApplied', { count: initialMigrations.length })}</span>
        ) : (
          <span>{t('pendingCount', { pending: pendingCount, applied: appliedCount })}</span>
        )}
        <button
          type="button"
          className="ghc-btn-primary"
          onClick={onUpgrade}
          disabled={pending}
        >
          {pending ? t('running') : t('runButton')}
        </button>
      </div>

      {error ? <div className="ghc-admin-form-status-error">{error}</div> : null}

      <ol className="ghc-upgrade-list">
        {initialMigrations.map((m) => (
          <li
            key={m.name}
            className="ghc-upgrade-row"
            data-applied={m.applied ? 'true' : 'false'}
          >
            <span className="ghc-upgrade-marker" aria-hidden>
              {m.applied ? '✓' : '○'}
            </span>
            <span className="ghc-upgrade-name">{m.slug}</span>
            <span className="ghc-upgrade-ts">{m.timestamp}</span>
            <span className="ghc-upgrade-status">
              {m.applied ? t('statusApplied') : t('statusPending')}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}