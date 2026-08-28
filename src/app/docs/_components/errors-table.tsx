import type { ReactElement } from 'react';
import type { ErrorDoc } from '@/lib/api-docs/types';

export function ErrorsTable({ errors }: { errors: ErrorDoc[] }): ReactElement {
  if (errors.length === 0) {
    return <p className="ghc-doc-empty">No documented errors.</p>;
  }
  return (
    <table className="ghc-doc-table">
      <thead>
        <tr><th>Status</th><th>Error</th><th>When</th></tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={`${e.status}-${e.error}`}>
            <td><code>{e.status}</code></td>
            <td><code>{e.error}</code></td>
            <td>{e.when}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
