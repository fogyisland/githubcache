import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

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
  meta: {
    title: 'Use the API in 4 steps',
    description: 'A 4-step walkthrough.',
  },
  eyebrow: 'Quickstart',
  title: 'Use the API in 4 steps',
  lede: 'githubcache is a cache for GitHub repository metadata.',
  treeheader: {
    branch: '4-step on-ramp',
    commitStep: 'step {n} of 4',
  },
  step1: {
    heading: 'Ask an admin for an account',
    body: 'Self-signup is not available.',
    calloutHeading: 'note',
    calloutBody: 'Already have an invite link? Open it.',
  },
  step2: {
    heading: 'Request an API key',
    body: 'After logging in.',
    action1: 'Log in at /login.',
    action2: 'Open /admin/api-keys.',
    action3: 'Click Request.',
  },
  step3: {
    heading: 'Wait for admin approval',
    body: 'Admin reviews your request.',
    calloutHeading: 'warning',
    calloutBody: 'Token is shown once.',
  },
  step4: {
    heading: 'Make your first call',
    body: 'Three examples.',
    example1Heading: 'no auth — sanity check',
    example1Body: 'Status endpoint.',
    example2Heading: 'no auth — single repo',
    example2Body: 'Public read.',
    example3Heading: 'auth — batch',
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
    devGuide: 'Dev guide',
    devGuideBody: 'fork, run, PR',
    specBody: 'machine-readable JSON',
  },
  blame: {
    lastTouched: 'last touched 2026-09-06',
    author: 'githubcache team',
    version: 'v1.0',
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

vi.mock('@/app/docs/_components/curl-example', () => ({
  CurlExample: ({ method, url }: { method: string; url: string }) =>
    createElement(
      'div',
      { 'data-testid': 'curl', 'data-method': method, 'data-url': url },
      createElement('code', null, `curl ${method} ${url}`),
    ),
}));

import GetStartedPage from '@/app/get-started/page';

describe('GetStartedPage — Repository Tree layout', () => {
  it('renders the paper surface wrapper', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-paper');
    expect(html).toContain('ghc-getstarted');
  });

  it('renders the file-tree header (path + branch)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-treeheader');
    expect(html).toContain('githubcache');
    expect(html).toContain('docs');
    expect(html).toContain('get-started.md');
    expect(html).toContain('ghc-path-leaf');
    expect(html).toContain('4-step on-ramp');
  });

  it('renders the H1 + lede (serif-styled, no eyebrow tag)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-h1');
    expect(html).toContain('Use the API in 4 steps');
    expect(html).toContain('ghc-getstarted-lede');
    // No "Quickstart" eyebrow tag — we removed it
    expect(html).not.toContain('Quickstart');
  });

  it('renders 4 commits on the git-graph log in order', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());

    // Log wrapper + connector
    expect(html).toContain('ghc-getstarted-log');

    // 4 commit nodes in correct order
    const shas = ['a3f7c1d', 'b1d49ee', '7c8a02f', 'e02a519'];
    let lastIdx = -1;
    for (const sha of shas) {
      const idx = html.indexOf(sha);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }

    // SHA + author + commit-step meta all rendered
    expect(html).toContain('sha');
    expect(html).toContain('author');
    expect(html).toContain('step 1 of 4');
    expect(html).toContain('step 4 of 4');

    // Commit kind annotations
    expect(html).toContain('data-commit-kind="feat"');
    expect(html).toContain('data-commit-kind="chore"');
    expect(html).toContain('data-commit-kind="docs"');
  });

  it('renders all 4 step headings in order on the commit bodies', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    const headings = [
      'Ask an admin for an account',
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

  it('renders step 2 sublist (numbered, mono-prefixed)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-sublist');
    expect(html).toContain('Log in at /login');
    expect(html).toContain('Open /admin/api-keys');
    expect(html).toContain('Click Request');
  });

  it('renders step 1 and step 3 callout notes (mono labels)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-note');
    expect(html).toContain('>note<');
    expect(html).toContain('>warning<');
    // Note labels are lowercase mono per design
    expect(html).toContain('ghc-getstarted-note-label');
  });

  it('renders 3 curl examples inside step 4 (GET GET POST)', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    const getMatches = html.match(/data-method="GET"/g) ?? [];
    const postMatches = html.match(/data-method="POST"/g) ?? [];
    expect(getMatches.length).toBe(2);
    expect(postMatches.length).toBe(1);
  });

  it('renders the error code table with all 4 rows', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-errortable');
    expect(html).toContain('unauthorized');
    expect(html).toContain('forbidden');
    expect(html).toContain('rate_limited');
    expect(html).toContain('not_found');
    // HTTP status column rendered
    expect(html).toContain('>401<');
    expect(html).toContain('>429<');
  });

  it('renders the blame row at the bottom', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-blame');
    expect(html).toContain('last touched 2026-09-06');
    expect(html).toContain('githubcache team');
    expect(html).toContain('v1.0');
  });

  it('renders the deeper-reading section', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-deeper');
    expect(html).toContain('/docs');
    expect(html).toContain('/docs/development');
    expect(html).toContain('/api-docs.json');
  });
});
