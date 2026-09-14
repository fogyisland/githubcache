import type { ReactElement } from 'react';
import { AddTokenForm } from './add-token-form';

export function TerminalEmptyState(): ReactElement {
  return (
    <div className="ghc-term-empty">
      <p className="ghc-term-section-heading">
        <span className="ghc-term-prompt">$</span>ls tokens
      </p>
      <p className="ghc-term-dim">no tokens found.</p>
      <p className="ghc-term-dim ghc-term-empty-hint">
        $ gh token create --scope repo
      </p>
      <p className="ghc-term-section-heading">
        <span className="ghc-term-prompt">&gt;</span>add first token
      </p>
      <AddTokenForm />
    </div>
  );
}