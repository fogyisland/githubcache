import type { ReactElement } from 'react';

// M26.x — /api/v1/repos now requires X-API-Key. Get a key from
// /account/keys, then send it as a header. Status endpoint at
// /api/v1/status is still the only public endpoint.
const CURL_EXAMPLE = `curl \\
  -H "X-API-Key: YOUR_KEY_HERE" \\
  https://your-host/api/v1/repos/torvalds/linux`;

const RESPONSE_SHAPE = `{
  "id": 2325298,
  "node_id": "R_kgDONF7KDA",
  "name": "linux",
  "full_name": "torvalds/linux",
  "private": false,
  "owner": { " "login": "torvalds", "id": 1024025, ... " },
  "html_url": "https://github.com/torvalds/linux",
  "description": "Linux kernel source tree",
  "fork": false,
  "stargazers_count": 172934,
  "watchers_count": 172934,
  "language": "C",
  "default_branch": "master",
  "node": { "...": "recursive tree snapshot, see /repo/{owner}/{name}" }
}`;

export function ApiDocSection(): ReactElement {
  return (
    <section className="ghc-api-doc" data-testid="ghc-api-doc-section">
      <div className="ghc-section-eyebrow">The API</div>
      <h2 className="ghc-section-heading">One curl, one JSON, no surprises.</h2>
      <div className="ghc-api-doc-grid">
        <div className="ghc-api-doc-card">
          <h3 className="ghc-api-doc-card-title">Request</h3>
          <pre className="ghc-code-block"><code>{CURL_EXAMPLE}</code></pre>
          <p className="ghc-api-doc-card-hint">
            No auth required for read-only lookups. Per-IP rate-limited (30/min
            default) — pass an API key for a higher quota.
          </p>
        </div>
        <div className="ghc-api-doc-card">
          <h3 className="ghc-api-doc-card-title">Response</h3>
          <pre className="ghc-code-block ghc-code-block-truncated"><code>{RESPONSE_SHAPE}</code></pre>
          <p className="ghc-api-doc-card-hint">
            A trimmed view — the real response includes the full GitHub repo
            object plus a recursive <code>node</code> tree (files + directories).
          </p>
        </div>
      </div>
    </section>
  );
}