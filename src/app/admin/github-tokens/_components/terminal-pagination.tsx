import type { ReactElement } from 'react';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';

interface Props {
  basePath: string;
  offset: number;
  limit: number;
  total: number;
  rowsOnPage: number;
  label: string;
}

export function TerminalPagination(props: Props): ReactElement | null {
  return (
    <div className="ghc-term-pagination">
      <AdminPagination {...props} />
    </div>
  );
}
