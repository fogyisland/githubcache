import type { ReactElement } from 'react';
import { CopyButton } from './copy-button';

interface CurlExampleProps {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function buildCurl({ method, url, headers, body }: CurlExampleProps): string {
  const lines: string[] = [`curl -X ${method} ${JSON.stringify(url)}`];
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      lines.push(`  -H ${JSON.stringify(`${k}: ${v}`)}`);
    }
  }
  if (body !== undefined) {
    lines.push(`  -d ${JSON.stringify(JSON.stringify(body))}`);
  }
  return lines.join(' \\\n');
}

export function CurlExample(props: CurlExampleProps): ReactElement {
  const cmd = buildCurl(props);
  return (
    <div className="ghc-doc-curl">
      <span className={`ghc-doc-method ghc-doc-method-${props.method}`}>{props.method}</span>
      <pre className="ghc-doc-code-block">
        <code>{cmd}</code>
      </pre>
      <CopyButton text={cmd} label="Copy curl" />
    </div>
  );
}
