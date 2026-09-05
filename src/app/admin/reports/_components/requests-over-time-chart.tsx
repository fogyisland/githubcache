'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslations } from 'next-intl';
import type { RequestsOverTimeBucket } from '@/lib/reports/queries';
import { formatTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface Props {
  data: RequestsOverTimeBucket[];
  tz: TimezoneId;
}

export function RequestsOverTimeChart({ data, tz }: Props) {
  const t = useTranslations('admin.reports.chart');
  const formatted = data.map((b) => ({
    hour: formatTime(b.hour, tz), // 'HH:MM'
    hits: b.cacheHits,
    misses: b.cacheMisses,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{t('heading')}</h2>
      {formatted.length === 0 ? (
        <p className="text-sm text-gray-500">{t('empty')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="hits" name={t('cacheHits')} stroke="#10b981" strokeWidth={2} />
            <Line type="monotone" dataKey="misses" name={t('cacheMisses')} stroke="#ef4444" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
