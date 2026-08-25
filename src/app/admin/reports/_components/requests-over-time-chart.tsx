'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { RequestsOverTimeBucket } from '@/lib/reports/queries';

interface Props {
  data: RequestsOverTimeBucket[];
}

export function RequestsOverTimeChart({ data }: Props) {
  const formatted = data.map((b) => ({
    hour: b.hour.toISOString().slice(11, 16), // 'HH:MM'
    'Cache hits': b.cacheHits,
    'Cache misses': b.cacheMisses,
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Requests over time (24h, hourly)</h2>
      {formatted.length === 0 ? (
        <p className="text-sm text-gray-500">No data in this window.</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="Cache hits" stroke="#10b981" strokeWidth={2} />
            <Line type="monotone" dataKey="Cache misses" stroke="#ef4444" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}