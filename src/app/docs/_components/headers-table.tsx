import type { ReactElement } from 'react';
import type { HeaderDoc } from '@/lib/api-docs/types';

export function HeadersTable({ headers }: { headers: HeaderDoc[] }): ReactElement {
  if (headers.length === 0) {
    return <p className="ghc-doc-empty">No documented headers.</p>;
  }
  return (
    <table className="ghc-doc-table">
      <thead>
        <tr><th>Header</th><th>Description</th><th>Example</th></tr>
      </thead>
      <tbody>
        {headers.map((h) => (
          <tr key={h.name}>
            <td><code>{h.name}</code></td>
            <td>{h.description}</td>
            <td><code>{h.example}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
