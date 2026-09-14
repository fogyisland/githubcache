import type { ReactElement, ReactNode } from 'react';

interface Props {
  title: string;
  count: number;
  children: ReactNode;
}

export function TerminalFrame({ title, count, children }: Props): ReactElement {
  return (
    <section className="ghc-term-frame" aria-label={title}>
      <span className="ghc-term-title">
        <span className="ghc-term-prompt">$</span>
        {title}
        <span className="ghc-term-dim"> · {count}</span>
      </span>
      {children}
    </section>
  );
}
