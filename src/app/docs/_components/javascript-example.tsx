import type { ReactElement } from 'react';
import { CopyButton } from './copy-button';

interface JavaScriptExampleProps {
  /** A runnable JavaScript snippet using fetch. */
  code: string;
  /** Optional filename for the copy button's filename hint. */
  filename?: string;
}

/**
 * M28.bug4e — JavaScript / browser fetch example block.
 *
 * Mirrors PythonExample but for browser / Node fetch() callers. The same
 * four rules apply (key from env / sessionStorage; X-API-Key header; raise
 * on non-2xx; parse once).
 */
export function JavaScriptExample({ code, filename }: JavaScriptExampleProps): ReactElement {
  return (
    <div className="ghc-doc-js">
      <div className="ghc-doc-code-header">
        <span className="ghc-doc-lang-tag">javascript</span>
        <CopyButton text={code} label={filename ?? 'copy javascript'} />
      </div>
      <pre className="ghc-doc-code-block">
        <code>{code}</code>
      </pre>
    </div>
  );
}
