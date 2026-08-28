import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface Props {
  totalRequests: number;
  cacheHitRate: number; // 0..1
  avgLatencyMs: number;
  activeApiKeys: number;
}

export async function KpiCards({ totalRequests, cacheHitRate, avgLatencyMs, activeApiKeys }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.reports.kpi');
  const cards = [
    { label: t('totalRequests'), value: totalRequests.toLocaleString() },
    { label: t('cacheHitRate'), value: `${(cacheHitRate * 100).toFixed(1)}%` },
    { label: t('avgLatency'), value: `${Math.round(avgLatencyMs)} ms` },
    { label: t('activeApiKeys'), value: activeApiKeys.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">{c.label}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
