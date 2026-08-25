interface Row {
  keyId: string;
  label: string;
  requestCount: number;
  lastUsed: Date | null;
}

export function TopKeysTable({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Top API keys</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No requests in this window.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 text-gray-500">
            <tr>
              <th className="py-2">Label</th>
              <th className="py-2 text-right">Requests</th>
              <th className="py-2 text-right">Last used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.keyId} className="border-b border-gray-100">
                <td className="py-2">
                  <a href={`/admin/api-keys/${k.keyId}`} className="text-blue-600 hover:underline">
                    {k.label}
                  </a>
                </td>
                <td className="py-2 text-right">{k.requestCount.toLocaleString()}</td>
                <td className="py-2 text-right text-gray-500">
                  {k.lastUsed ? k.lastUsed.toISOString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}