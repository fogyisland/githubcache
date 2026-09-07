import type { ReactElement } from 'react';
import { CopyButton } from './copy-button';

interface PythonExampleProps {
  /** A runnable Python snippet using the `requests` library. */
  code: string;
  /** Optional filename for the copy button's filename hint. */
  filename?: string;
}

/**
 * M28.bug4e — Python example block for the public API docs.
 *
 * Mirrors the existing CurlExample. The Python snippet is shown verbatim
 * with a copy button; the snippet uses only `requests` (stdlib-adjacent,
 * ships in most Python environments) and assumes `os.environ.get('GHC_KEY')`
 * for the API key so secrets never appear in the URL or payload.
 *
 * If you write Python against the githubcache API, this is the canonical
 * pattern:
 *   1. Read the key from the environment, never hard-code.
 *   2. Send `X-API-Key` header (NOT a `?key=` query param — those would
 *      land in access logs).
 *   3. Raise on non-2xx so callers handle errors explicitly.
 *   4. Parse the JSON once and return the typed dict to your caller.
 */
export function PythonExample({ code, filename }: PythonExampleProps): ReactElement {
  return (
    <div className="ghc-doc-python">
      <div className="ghc-doc-code-header">
        <span className="ghc-doc-lang-tag">python</span>
        <CopyButton text={code} label={filename ?? 'copy python'} />
      </div>
      <pre className="ghc-doc-code-block">
        <code>{code}</code>
      </pre>
    </div>
  );
}
