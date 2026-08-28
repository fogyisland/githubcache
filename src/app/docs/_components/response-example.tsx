import type { ReactElement } from 'react';

interface ResponseExampleProps {
  sample: unknown;
}

/**
 * Server-rendered JSON with simple keyword highlighting via span classes.
 * NOT a full JSON parser — assumes valid JSON; uses JSON.stringify then
 * regex-classifies tokens.
 */
export function ResponseExample({ sample }: ResponseExampleProps): ReactElement {
  const json = JSON.stringify(sample, null, 2);
  // Tokenize: keys, strings, numbers, booleans, null.
  const highlighted = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="ghc-json-key">$1</span>$2')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="ghc-json-string">$1</span>')
    .replace(/\b(true|false)\b/g, '<span class="ghc-json-bool">$1</span>')
    .replace(/\bnull\b/g, '<span class="ghc-json-null">null</span>')
    .replace(/(?<![\w"])(-?\d+(?:\.\d+)?)(?![\w"])/g, '<span class="ghc-json-number">$1</span>');
  return (
    <pre className="ghc-doc-code-block">
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}
