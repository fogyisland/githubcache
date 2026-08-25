import type { TopRepo } from '@/lib/reports/queries';

export function TopReposTable({ rows }: { rows: TopRepo[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Top repositories</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No requests in this window.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">Repository</th>
              <th className="py-2 text-right">Requests</th>
              <th className="py-2 text-right">Hit rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.repo} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">{r.repo}</td>
                <td className="py-2 text-right">{r.requestCount.toLocaleString()}</td>
                <td className="py-2 text-right">{(r.hitRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}