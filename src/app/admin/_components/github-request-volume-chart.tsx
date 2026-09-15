'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslations } from 'next-intl';
import type { GithubRequestVolumeBucket } from '@/lib/admin/github-request-volume';
import { formatTime, formatDate } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface Props {
  data: GithubRequestVolumeBucket[];
  tz: TimezoneId;
  window: '24h' | '7d';
}

/**
 * M32.7.6 — three-line chart of upstream GitHub API call volume
 * (core / releases / branches). Mirrors the recharts shape used by
 * /admin/reports/requests-over-time-chart.tsx; the only difference
 * is the additional `releases` and `branches` lines.
 */
export function GithubRequestVolumeChart({ data, tz, window }: Props) {
  const t = useTranslations('admin.shell.dashboard.githubVolume');
  const formatter = window === '24h' ? formatTime : formatDate;
  const formatted = data.map((b) => ({
    label: formatter(b.hour, tz),
    core: b.core,
    releases: b.releases,
    branches: b.branches,
  }));

  const isEmpty = formatted.every(
    (b) => b.core === 0 && b.releases === 0 && b.branches === 0,
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{t('heading')}</h2>
        <p className="text-xs text-gray-500">{t('hint')}</p>
      </div>
      {isEmpty ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="core" name={t('core')} stroke="#6366f1" strokeWidth={2} />
            <Line type="monotone" dataKey="releases" name={t('releases')} stroke="#10b981" strokeWidth={2} />
            <Line type="monotone" dataKey="branches" name={t('branches')} stroke="#f59e0b" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
