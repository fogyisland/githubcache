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
  step1: {
    heading: 'Ask an admin for an account',
    body: 'Self-signup is not available.',
    calloutLabel: 'note',
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
    calloutLabel: 'warning',
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

describe('GetStartedPage — Wulan-aligned step cards', () => {
  it('renders the page wrapper with Wulan eyebrow + h1 + lede', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted');
    expect(html).toContain('ghc-getstarted-eyebrow');
    expect(html).toContain('Quickstart');
    expect(html).toContain('ghc-getstarted-h1');
    expect(html).toContain('Use the API in 4 steps');
    expect(html).toContain('ghc-getstarted-lede');
  });

  it('renders 4 step cards in order with sky-blue number pills', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    const cards = html.match(/ghc-getstarted-step\b/g) ?? [];
    expect(cards.length).toBeGreaterThanOrEqual(4);

    const nums = html.match(/ghc-getstarted-step-num">\d+</g) ?? [];
    expect(nums).toEqual([
      'ghc-getstarted-step-num">1<',
      'ghc-getstarted-step-num">2<',
      'ghc-getstarted-step-num">3<',
      'ghc-getstarted-step-num">4<',
    ]);
  });

  it('renders all 4 step headings in order', async () => {
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

  it('renders step 2 sublist with counter-reset items', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-sublist');
    expect(html).toContain('Log in at /login');
    expect(html).toContain('Open /admin/api-keys');
    expect(html).toContain('Click Request');
  });

  it('renders step 1 + step 3 callouts with mono uppercase labels', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-callout');
    // calloutLabel keys render uppercase via CSS (text-transform), but the
    // mock just returns the literal — assert the literals are present.
    expect(html).toContain('ghc-getstarted-callout-label');
    expect(html).toContain('>note<');
    expect(html).toContain('>warning<');
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
    expect(html).toContain('ghc-getstarted-error-table');
    expect(html).toContain('unauthorized');
    expect(html).toContain('forbidden');
    expect(html).toContain('rate_limited');
    expect(html).toContain('not_found');
    expect(html).toContain('>401<');
    expect(html).toContain('>429<');
  });

  it('renders the deeper-reading section with 3 links', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-deeper');
    expect(html).toContain('/docs');
    expect(html).toContain('/docs/development');
    expect(html).toContain('/api-docs.json');
  });
});