'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * URL-driven date range picker for the /admin/queries page.
 *
 * Mirrors the pattern in /admin/audit/_components/audit-filters.tsx — the
 * page is a server component reading searchParams, and this client
 * component is the only thing that touches the URL. Two `<input
 * type="date">` fields (no time picker, consistent with /admin/audit) plus
 * Apply / Reset. Filter changes reset pagination.
 */
export function QueriesDateRange() {
  const t = useTranslations('admin.queries.dateRange');
  const router = useRouter();
  const params = useSearchParams();
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function apply(): void {
    const u = new URL(window.location.href);
    const p = u.searchParams;
    p.delete('offset');
    if (from) p.set('from', from); else p.delete('from');
    if (to) p.set('to', to); else p.delete('to');
    router.push(u.pathname + '?' + p.toString());
  }

  function reset(): void {
    setFrom('');
    setTo('');
    router.push('/admin/queries');
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <div className="mt-4 flex gap-2">
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