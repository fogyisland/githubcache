interface Props {
  totalRequests: number;
  cacheHitRate: number; // 0..1
  avgLatencyMs: number;
  activeApiKeys: number;
}

export function KpiCards({ totalRequests, cacheHitRate, avgLatencyMs, activeApiKeys }: Props) {
  const cards = [
    { label: 'Total requests', value: totalRequests.toLocaleString() },
    { label: 'Cache hit rate', value: `${(cacheHitRate * 100).toFixed(1)}%` },
    { label: 'Avg latency', value: `${Math.round(avgLatencyMs)} ms` },
    { label: 'Active API keys', value: activeApiKeys.toLocaleString() },
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