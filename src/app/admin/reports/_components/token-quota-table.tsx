interface Row {
  id: string;
  label: string;
  status: string;
  requestsUsed: number;
  requestsLimit: number;
  resetAt: Date | null;
}

export function TokenQuotaTable({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Token quota usage</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No tokens registered.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">Label</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Used</th>
              <th className="py-2 text-right">Limit</th>
              <th className="py-2 text-right">Used %</th>
              <th className="py-2 text-right">Resets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const pct = t.requestsLimit === 0 ? 0 : (t.requestsUsed / t.requestsLimit) * 100;
              return (
                <tr key={t.id} className="border-b border-gray-100">
                  <td className="py-2">{t.label}</td>
                  <td className="py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        t.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">{t.requestsUsed.toLocaleString()}</td>
                  <td className="py-2 text-right">{t.requestsLimit.toLocaleString()}</td>
                  <td className="py-2 text-right">{pct.toFixed(1)}%</td>
                  <td className="py-2 text-right text-gray-500">
                    {t.resetAt ? t.resetAt.toISOString() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}