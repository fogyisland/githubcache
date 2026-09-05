import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/client';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface QueryRow {
  id: bigint;
  createdAt: Date;
  endpoint: string;
  apiKeyId: bigint | null;
  statusCode: number;
  durationMs: number;
}

interface KeyLookup {
  id: bigint;
  name: string;
}

interface RecentQueriesProps {
  owner: string;
  name: string;
}

function statusClass(code: number): string {
  if (code >= 500) return 'font-semibold text-red-600';
  if (code >= 400) return 'font-semibold text-amber-600';
  if (code >= 300) return 'font-semibold text-blue-600';
  return 'text-[color:var(--color-ink)]';
}

/**
 * "Recent queries for this repo" section for the public /repo/[owner]/[name]
 * page (M24). Shows the 10 most recent request_log rows whose
 * `repo_requested` matches owner/name. Each row links its API-key label
 * (if any) to /admin/api-keys/[id]; anonymous rows render the literal
 * "anonymous" string.
 *
 * The key lookup is N+1-safe — a single `findMany` resolves all the
 * apiKeyIds in the page.
 */
export async function RecentQueries({
  owner,
  name,
}: RecentQueriesProps): Promise<ReactElement> {
  const t = await getTranslations('repo.recentQueries');
  const tz = resolveRequestTimezone({});

  const repoKey = `${owner}/${name}`;

  let rows: QueryRow[] = [];
  let keyMap = new Map<string, string>();
  try {
    rows = await prisma.requestLog.findMany({
      where: { repoRequested: repoKey },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        endpoint: true,
        apiKeyId: true,
        statusCode: true,
        durationMs: true,
      },
    });
    const keyIds = [
      ...new Set(
        rows.map((r) => r.apiKeyId).filter((id): id is bigint => id !== null),
      ),
    ];
    if (keyIds.length > 0) {
      const keys = await prisma.apiKey.findMany({
        where: { id: { in: keyIds } },
        select: { id: true, name: true },
      });
      keyMap = new Map(
        (keys as KeyLookup[]).map((k) => [k.id.toString(), k.name]),
      );
    }
  } catch {
    rows = [];
    keyMap = new Map();
  }

  return (
    <div className="ghc-card p-5" data-testid="ghc-recent-queries">
      <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">
        {t('heading')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--color-ink-muted)]">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-rule)]">
          {rows.map((r) => {
            const keyId = r.apiKeyId?.toString() ?? null;
            const keyName = keyId ? (keyMap.get(keyId) ?? null) : null;
            return (
              <li
                key={r.id.toString()}
                className="flex flex-wrap items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                  {formatDateTime(r.createdAt, tz)}
                </span>
                <span className="font-mono text-xs">{r.endpoint}</span>
                <span className={`text-right font-mono text-xs ${statusClass(r.statusCode)}`}>
                  {r.statusCode}
                </span>
                <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                  {r.durationMs} ms
                </span>
                {keyId && keyName ? (
                  <Link
                    href={`/admin/api-keys/${keyId}`}
                    className="ghc-link text-xs"
                  >
                    {keyName}
                  </Link>
                ) : (
                  <span className="text-xs text-[color:var(--color-ink-muted)]">
                    {t('anonymous')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
