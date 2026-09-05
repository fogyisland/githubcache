import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { BranchSummary } from '@/lib/repo/metadata';

interface BranchesListProps {
  owner: string;
  name: string;
  branches: BranchSummary[];
}

/**
 * "Branches / 分支列表" section for the public repo page.
 *
 * Renders the cached `branches` projection (top 20 by default — GitHub
 * caps our fetch at 20). Each row links to the branch page on GitHub
 * with the latest commit SHA in the URL (`?query=<sha>`).
 *
 * Hidden when the repo has no branches cached (fetchVersionExtras
 * failure leaves an empty array).
 */
export async function BranchesList({
  owner,
  name,
  branches,
}: BranchesListProps): Promise<ReactElement | null> {
  const t = await getTranslations('repo.branches');

  if (branches.length === 0) {
    return null;
  }

  const repoUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  return (
    <div className="ghc-card p-5" data-testid="ghc-branches">
      <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">
        {t('heading')}
      </h2>
      <ul className="divide-y divide-[color:var(--color-rule)]">
        {branches.map((br) => {
          const branchUrl = `${repoUrl}/tree/${encodeURIComponent(br.name)}`;
          const shaUrl = br.commit_sha
            ? `${repoUrl}/commit/${br.commit_sha}`
            : null;
          return (
            <li
              key={br.name}
              className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm"
            >
              <a
                href={branchUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="ghc-link font-mono text-sm font-semibold"
              >
                {br.name}
              </a>
              {br.protected ? (
                <span className="ghc-admin-chip ghc-admin-chip-warn">
                  {t('protected')}
                </span>
              ) : (
                <span className="ghc-admin-chip ghc-admin-chip-neutral">
                  {t('unprotected')}
                </span>
              )}
              {br.commit_sha ? (
                shaUrl ? (
                  <a
                    href={shaUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ghc-link font-mono text-xs text-[color:var(--color-ink-muted)]"
                    title={br.commit_sha}
                  >
                    {br.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  <code
                    className="font-mono text-xs text-[color:var(--color-ink-muted)]"
                    title={br.commit_sha}
                  >
                    {br.commit_sha.slice(0, 7)}
                  </code>
                )
              ) : (
                <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                  {t('noSha')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}