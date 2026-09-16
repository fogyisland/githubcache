'use client';

import type { ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

const STATUSES = ['', 'pending', 'in_progress', 'done', 'failed'] as const;
const KINDS = ['', 'core', 'releases', 'branches'] as const;

/**
 * URL-based filter UI for `/admin/refresh-jobs`. The page itself is a
 * server component and reads `searchParams` from the URL; this client
 * component updates the URL on submit.
 *
 * Mirrors the `audit-filters.tsx` pattern (router.push with mutated
 * URLSearchParams; resets `offset` on filter change so the user doesn't
 * land on a stale page).
 *
 * Filters: status / kind / owner substring / name substring / updatedAt
 * range. Empty fields are stripped from the URL.
 */
export function RefreshJobsFilters(): ReactElement {
  const t = useTranslations('admin.refreshJobs.filters');
  const router = useRouter();
  const params = useSearchParams();

  const [status, setStatus] = useState<string>(params.get('status') ?? '');
  const [kind, setKind] = useState<string>(params.get('kind') ?? '');
  const [owner, setOwner] = useState<string>(params.get('owner') ?? '');
  const [name, setName] = useState<string>(params.get('name') ?? '');
  const [from, setFrom] = useState<string>(params.get('from') ?? '');
  const [to, setTo] = useState<string>(params.get('to') ?? '');

  function apply(): void {
    const u = new URL(window.location.href);
    const p = u.searchParams;
    p.delete('offset'); // reset pagination on filter change
    if (status) p.set('status', status);
    else p.delete('status');
    if (kind) p.set('kind', kind);
    else p.delete('kind');
    if (owner) p.set('owner', owner);
    else p.delete('owner');
    if (name) p.set('name', name);
    else p.delete('name');
    if (from) p.set('from', from);
    else p.delete('from');
    if (to) p.set('to', to);
    else p.delete('to');
    router.push(u.pathname + '?' + p.toString());
  }

  function reset(): void {
    setStatus('');
    setKind('');
    setOwner('');
    setName('');
    setFrom('');
    setTo('');
    router.push('/admin/refresh-jobs');
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('status')}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || t('anyOption')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('kind')}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k || t('anyOption')}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('owner')}</span>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder={t('ownerPlaceholder')}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('name')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('from')}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="text-gray-600">{t('to')}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('apply')}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('reset')}
        </button>
      </div>
    </div>
  );
}