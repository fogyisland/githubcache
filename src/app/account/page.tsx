import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { prisma } from '@/lib/db/client';

/**
 * M26 — /account overview.
 *
 * Welcome card + 4 stat tiles (role / status / member-since / prefs
 * snapshot) + a "Request a new API key" call-to-action.
 *
 * The session is already validated by the parent layout; we re-read
 * it here to get the user's role / status / createdAt for the tiles.
 *
 * M26.x — styling routed through the ghc-* class system
 * (ghc-card / ghc-btn-primary / ghc-text-muted) so colors track the
 * active theme tokens instead of inlining CSS variables. Avoids the
 * "one element blue, one element white" drift between pages.
 */
export default async function AccountOverviewPage(): Promise<ReactElement> {
  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    // Layout already redirected, but TypeScript needs the null-check.
    return <></>;
  }

  const t = await getTranslations('account.overview');
  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  // Pull a quick key count for the "your activity" tile.
  const keyCount = await prisma.apiKey.count({ where: { userId: user.id } });

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <div className="ghc-card p-6">
        <h2 className="text-lg font-semibold">{t('welcome', { email: user.email })}</h2>
        <p className="mt-2 text-sm ghc-text-muted">{t('subtitle')}</p>
      </div>

      <section
        aria-label={t('profileHeading')}
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}
      >
        <Tile label={t('tiles.role')} value={t(`role.${user.role}`)} />
        <Tile label={t('tiles.status')} value={t(`status.${user.status}`)} />
        <Tile label={t('tiles.memberSince')} value={formatDate(user.createdAt, userTz)} />
        <Tile label={t('tiles.apiKeys')} value={String(keyCount)} />
        <Tile
          label={t('tiles.lang')}
          value={user.lang === 'zh' ? '中文' : 'EN'}
        />
        <Tile label={t('tiles.theme')} value={user.theme} />
        <Tile label={t('tiles.timezone')} value={user.timezone ?? t('tiles.defaultTz')} />
      </section>

      <div className="ghc-card p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold">{t('cta.title')}</h3>
          <p className="mt-1 text-sm ghc-text-muted">{t('cta.body')}</p>
        </div>
        <Link href="/account/keys/request" className="ghc-btn-primary">
          {t('cta.button')}
        </Link>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="ghc-card p-4">
      <p className="text-xs font-medium tracking-wide uppercase ghc-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ wordBreak: 'break-word' }}>
        {value}
      </p>
    </div>
  );
}
