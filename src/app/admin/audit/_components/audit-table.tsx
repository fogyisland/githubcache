interface Row {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: unknown;
}

interface Props {
  rows: Row[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Server-rendered audit log table. Shows rows, the current range, and
 * prev/next pagination controls.
 *
 * TODO(M7.5): Prev/next currently preserves only `offset`+`limit` — filters
 * reset on pagination. Future polish: preserve all filters in prev/next
 * href builders.
 */
export function AuditTable({ rows, total, limit, offset }: Props) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = end < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm text-gray-600">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} entries
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No matching entries.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2">When</th>
                <th className="py-2">Action</th>
                <th className="py-2">Actor</th>
                <th className="py-2">Target</th>
                <th className="py-2">IP</th>
                <th className="py-2">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 font-mono text-xs whitespace-nowrap">
                    {r.createdAt.toISOString()}
                  </td>
                  <td className="py-2">
                    <span className="rounded bg-gray-100 px-2 py-1 font-mono text-xs">
                      {r.action}
                    </span>
                  </td>
                  <td className="py-2">
                    {r.actorEmail ? (
                      <div>
                        <div>{r.actorEmail}</div>
                        <div className="font-mono text-xs text-gray-500">#{r.actorUserId}</div>
                      </div>
                    ) : r.actorUserId ? (
                      <span className="font-mono text-xs">#{r.actorUserId}</span>
                    ) : (
                      <span className="text-gray-400">system</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="font-mono text-xs">{r.targetType}</div>
                    <div className="font-mono text-xs text-gray-500">{r.targetId}</div>
                  </td>
                  <td className="py-2 font-mono text-xs">{r.ip ?? '—'}</td>
                  <td className="py-2">
                    <code className="block max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-xs">
                      {JSON.stringify(r.metadata, null, 2)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <a
          href={`?offset=${prevOffset}&limit=${limit}`}
          className={`rounded border border-gray-300 bg-white px-3 py-1 text-sm ${
            !hasPrev ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'
          }`}
          aria-disabled={!hasPrev}
        >
          ← Previous
        </a>
        <span className="text-sm text-gray-600">
          Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}
        </span>
        <a
          href={`?offset=${nextOffset}&limit=${limit}`}
          className={`rounded border border-gray-300 bg-white px-3 py-1 text-sm ${
            !hasNext ? 'pointer-events-none opacity-50' : 'hover:bg-gray-50'
          }`}
          aria-disabled={!hasNext}
        >
          Next →
        </a>
      </div>
    </div>
  );
}
