import type { ReactElement, ReactNode } from 'react';
import { DocsSidebar } from './_components/docs-sidebar';

export default function DocsLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="ghc-doc-shell">
      <DocsSidebar />
      <main className="ghc-doc-main">{children}</main>
    </div>
  );
}
