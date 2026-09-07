import type { EndpointDoc } from './types';

const PYTHON_IMPORT = `import os
import sys
import requests

BASE = "https://githubcache.example.com"
API_KEY = os.environ["GHC_API_KEY"]  # never hard-code the key`;

/**
 * M28.bug4e — generate a Python snippet for an endpoint.
 *
 * The output is intentionally complete and runnable: it imports `requests`,
 * reads the key from `GHC_API_KEY` env, raises on non-2xx, and prints the
 * JSON response. Users can copy-paste and start using the API in 30s.
 *
 * The body for POST endpoints is taken from the first item in
 * `request.filter(in='body')` parsed as JSON; for /api/query specifically
 * we emit a sensible default. Anything more complex (pagination, retry
 * loops) is left as an exercise — the docs show the canonical request
 * shape, not the production retry wrapper.
 */
export function buildPython(doc: EndpointDoc): string {
  if (doc.examples?.python !== undefined) return doc.examples.python;

  const url = `https://githubcache.example.com${doc.path}`;
  const lines: string[] = [PYTHON_IMPORT, ''];

  if (doc.method === 'GET') {
    lines.push(`resp = requests.get(`);
    lines.push(`    ${JSON.stringify(url)},`);
    if (doc.auth === 'X-API-Key') {
      lines.push(`    headers={"X-API-Key": API_KEY},`);
    }
    lines.push(`    timeout=10,`);
    lines.push(`)`);
  } else {
    // POST — assume a JSON body keyed by the first non-header body param.
    const bodyParam = doc.request?.find((p) => p.in === 'body');
    const bodyObj =
      doc.slug === 'api/query'
        ? { nodes: [{ owner: 'octocat', name: 'Hello-World' }] }
        : bodyParam
          ? { [bodyParam.name]: '<value>' }
          : {};
    lines.push(`resp = requests.post(`);
    lines.push(`    ${JSON.stringify(url)},`);
    if (doc.auth === 'X-API-Key') {
      lines.push(`    headers={"X-API-Key": API_KEY},`);
    }
    lines.push(
      `    json=${JSON.stringify(bodyObj, null, 2)
        .split('\n')
        .join('\n    ')},`,
    );
    lines.push(`    timeout=10,`);
    lines.push(`)`);
  }
  lines.push(`resp.raise_for_status()`);
  lines.push(`data = resp.json()`);
  lines.push(`print(json.dumps(data, indent=2))`);
  // Add a json import if not present.
  if (!lines.includes('import json')) {
    lines.unshift('import json');
  }
  return lines.join('\n');
}

/**
 * M28.bug4e — generate a JavaScript snippet for an endpoint.
 *
 * Browser-style fetch. The API key is read from `process.env` (server-side)
 * by default; browser callers should proxy through their own backend and
 * never expose the key to the client bundle. The generated snippet bakes
 * in the recommended pattern.
 *
 * Implementation note: we avoid TypeScript template literals for the
 * output by composing the snippet as a plain string — the user copies
 * the literal text, so the `${BASE}` in their copy must be a real
 * template literal, not a TS-escaped placeholder.
 */
export function buildJavaScript(doc: EndpointDoc): string {
  if (doc.examples?.javascript !== undefined) return doc.examples.javascript;

  const lines: string[] = [];

  lines.push(`// Server-side: read from env. Browser: proxy through your backend; never commit the key to a bundle.`);
  lines.push(`const BASE = 'https://githubcache.example.com';`);
  if (doc.auth === 'X-API-Key') {
    lines.push(`const apiKey = process.env.GHC_API_KEY;`);
  }
  lines.push('');

  const headersObj =
    doc.auth === 'X-API-Key'
      ? `{ 'X-API-Key': apiKey }`
      : `undefined`;

  if (doc.method === 'GET') {
    lines.push(`const resp = await fetch(BASE + '${doc.path}', {`);
    lines.push(`  headers: ${headersObj},`);
    lines.push(`});`);
  } else {
    const bodyObj =
      doc.slug === 'api/query'
        ? { nodes: [{ owner: 'octocat', name: 'Hello-World' }] }
        : { nodes: [{ owner: '<owner>', name: '<name>' }] };
    lines.push(`const resp = await fetch(BASE + '${doc.path}', {`);
    lines.push(`  method: 'POST',`);
    lines.push(
      `  headers: { ...${headersObj}, 'content-type': 'application/json' },`,
    );
    lines.push(`  body: JSON.stringify(${JSON.stringify(bodyObj)}),`);
    lines.push(`});`);
  }
  lines.push(`if (!resp.ok) {`);
  lines.push(`  throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()));`);
  lines.push(`}`);
  lines.push(`const data = await resp.json();`);
  lines.push(`console.log(data);`);
  return lines.join('\n');
}