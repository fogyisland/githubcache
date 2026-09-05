import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { formatDate } from '@/lib/repo/metadata';
import type { ReleaseSummary } from '@/lib/repo/metadata';

interface ReleasesListProps {
  owner: string;
  name: string;
  releases: ReleaseSummary[];
  latestTag: string | null;
}

/**
 * "Versions / 版本发布" section for the public repo page.
 *
 * Lists the cached `recentReleases` projection (top 10 published, plus
 * pre-releases and drafts). The "Latest" chip is bound to the
 * `latestRelease.tag_name` we have in the cache — it matches the
 * first row if the latest release is in the top-10, else it's pinned
 * to the first row anyway because recentReleases is sorted by
 * published_at desc by the GitHub fetcher.
 *
 * Hidden when the repo has no releases at all (avoids an empty card
 * showing for repos like octocat/Hello-World).
 */
export async function ReleasesList({
  owner,
  name,
  releases,
  latestTag,
}: ReleasesListProps): Promise<ReactElement | null> {
  const t = await getTranslations('repo.releases');

  if (releases.length === 0) {
    // Skip the section entirely when the repo has zero releases. The
    // /releases section is empty for repos like octocat/Hello-World and
    // would just add noise.
    return null;
  }

  return (
    <div className="ghc-card p-5" data-testid="ghc-releases">
      <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-[color:var(--color-rule)]">
        {releases.map((rel) => {
          const isLatest = latestTag !== null && rel.tag_name === latestTag;
          const badges: Array<{ key: string; cls: string }> = [];
          if (rel.prerelease) badges.push({ key: 'prerelease', cls: 'ghc-admin-chip-warn' });
          if (rel.draft) badges.push({ key: 'draft', cls: 'ghc-admin-chip-neutral' });
          return (
            <li
              key={rel.tag_name}
              className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <a
                  href={rel.html_url || `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/tag/${encodeURIComponent(rel.tag_name)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ghc-link font-mono text-sm font-semibold"
                >
                  {rel.tag_name}
                </a>
                {isLatest && (
                  <span className="ghc-admin-chip ghc-admin-chip-info">
                    {t('latestBadge')}
                  </span>
                )}
                {badges.map((b) => (
                  <span key={b.key} className={`ghc-admin-chip ${b.cls}`}>
                    {t(`badge.${b.key}` as 'badge.prerelease')}
                  </span>
                ))}
              </span>
              <span className="text-[color:var(--color-ink)]">
                {rel.name ?? t('noName')}
              </span>
              <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                {rel.published_at ? formatDate(rel.published_at) : '—'}
              </span>
              {rel.assets_count > 0 && (
                <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                  {rel.assets_count} asset{rel.assets_count === 1 ? '' : 's'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}