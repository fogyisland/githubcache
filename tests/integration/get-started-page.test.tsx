import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

function flattenDict(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenDict(v as Record<string, unknown>, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

const getStartedDict = flattenDict({
  getStarted: {
  meta: {
    title: 'Use the API in 4 steps',
    description: 'A 4-step walkthrough.',
  },
  eyebrow: 'Quickstart',
  title: 'Use the API in 4 steps',
  lede: 'githubcache is a cache for GitHub repository metadata.',
  copy: { copy: 'Copy', copied: 'Copied' },
  tabs: { curl: 'curl', python: 'Python', nodejs: 'Node.js', powershell: 'PowerShell' },
  step1: {
    heading: 'Create an account',
    body: 'Public signup is open. Email + password.',
    cta: 'Go to /signup →',
  },
  step2: {
    heading: 'Request an API key',
    body: 'Logged-in users request their own keys from /account.',
    cta: 'Go to /account/keys/request →',
  },
  step3: {
    heading: 'Wait for admin approval',
    body: 'Admin reviews your request and approves it.',
    calloutLabel: 'warning',
    calloutBody: 'The plaintext token is shown ONCE — copy it the moment it appears.',
  },
  step4: {
    heading: 'Make your first call',
    body: 'Three examples.',
    tagPublic: 'Public · no auth',
    tagSingle: 'Auth · 1 repo',
    tagBatch: 'Auth · batch of 50',
    example1Heading: 'Sanity check',
    example1Body: 'Status endpoint.',
    example2Heading: 'Fetch one',
    example2Body: 'Public read.',
    example3Heading: 'Batch',
    example3Body: 'Authenticated.',
    errorsHeading: 'common error codes',
    errorCol: { code: 'code', status: 'http', meaning: 'meaning' },
    errors: {
      unauthorized: 'Missing X-API-Key.',
      forbidden: 'Key invalid or revoked.',
      rate_limited: 'Bucket exhausted.',
      not_found: 'Repo does not exist.',
    },
  },
  deeper: {
    heading: 'Deeper reading',
    apiRef: 'API reference',
    apiRefBody: 'every endpoint',
    devGuide: 'Development & contributing guide',
    devGuideBody: 'fork, run, PR',
    yourKeys: 'Your API keys',
    yourKeysBody: 'manage + revoke at /account/keys',
    specBody: 'machine-readable JSON',
  },
  },
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    return (key: string, vars?: Record<string, string | number>) => {
      const v = getStartedDict[`${ns}.${key}`] ?? getStartedDict[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

import GetStartedPage from '@/app/get-started/page';

describe('GetStartedPage — vertical 4-step walkthrough', () => {
  it('renders the page wrapper with eyebrow + h1 + lede', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted');
    expect(html).toContain('ghc-getstarted-eyebrow');
    expect(html).toContain('Quickstart');
    expect(html).toContain('ghc-getstarted-h1');
    expect(html).toContain('Use the API in 4 steps');
    expect(html).toContain('ghc-getstarted-lede');
  });

  it('renders 4 step cards inside an <ol> with counter-reset', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    // The step list is a single ordered list, not a 4-column grid.
    expect(html).toContain('ghc-getstarted-steps');
    const ol = html.match(/<ol class="ghc-getstarted-steps"/);
    expect(ol).not.toBeNull();
    // No more 4-col grid wrapper.
    expect(html).not.toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-4');
  });

  it('renders 4 step cards with their heading + auto-numbered circles', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    const cards = html.match(/ghc-getstarted-step\b/g) ?? [];
    expect(cards.length).toBeGreaterThanOrEqual(4);

    // Number circles no longer carry digit text — the digit is rendered
    // by the CSS counter, so the markup just has the empty <span>.
    const numSpans = html.match(/<span class="ghc-getstarted-step-num" aria-hidden="true"><\/span>/g) ?? [];
    expect(numSpans.length).toBe(4);
  });

  it('renders all 4 step headings in order', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    const headings = [
      'Create an account',
      'Request an API key',
      'Wait for admin approval',
      'Make your first call',
    ];
    let lastIdx = -1;
    for (const h of headings) {
      const idx = html.indexOf(h);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('renders step 3 callout with mono uppercase label', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-callout');
    expect(html).toContain('ghc-getstarted-callout-label');
    expect(html).toContain('>warning<');
  });

  it('renders 3 multi-language code example blocks inside step 4', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    // Three example wrappers (one per code example in step 4).
    const wrappers = html.match(/ghc-getstarted-example-wrapper/g) ?? [];
    expect(wrappers.length).toBe(3);
    // Each holds a tablist with 4 tabs (curl, Python, Node.js, PowerShell).
    const tablists = html.match(/<div role="tablist"/g) ?? [];
    expect(tablists.length).toBe(3);
    const tabs = html.match(/role="tab"/g) ?? [];
    expect(tabs.length).toBe(12);
    // Each tablist shows all 4 language labels.
    expect(html).toContain('>curl<');
    expect(html).toContain('>Python<');
    expect(html).toContain('>Node.js<');
    expect(html).toContain('>PowerShell<');
    // Copy button + curl pre + status chip remain.
    expect(html).toContain('ghc-getstarted-copy-btn');
    expect(html).toContain('ghc-getstarted-curl');
  });

  it('renders the error code table with all 4 rows + status chips', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-error-table');
    expect(html).toContain('unauthorized');
    expect(html).toContain('forbidden');
    expect(html).toContain('rate_limited');
    expect(html).toContain('not_found');
    // Status chips wrap the HTTP code.
    expect(html).toContain('ghc-getstarted-status');
    expect(html).toContain('>401<');
    expect(html).toContain('>429<');
  });

  it('renders the deeper-reading definition list (not em-dash bullets)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-deeper');
    expect(html).toContain('ghc-getstarted-deeper-list');
    // 4 <dt>/<dd> pairs.
    const dts = html.match(/<dt>/g) ?? [];
    const dds = html.match(/<dd>/g) ?? [];
    expect(dts.length).toBe(4);
    expect(dds.length).toBe(4);
    expect(html).toContain('/docs');
    expect(html).toContain('/docs/development');
    expect(html).toContain('/api-docs.json');
  });

  // Smoke: copy button is a real client component (no JSX errors when
  // rendered through the server boundary).
  it('does not throw when rendered with the CopyButton island', async () => {
    const html = await GetStartedPage();
    expect(() => renderToStaticMarkup(html)).not.toThrow();
  });
});