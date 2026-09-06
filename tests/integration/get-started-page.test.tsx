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
    heading: 'Create an account',
    body: 'Public signup is open. Email + password.',
    action1: 'Open /signup.',
    action2: 'Enter email + password.',
    action3: 'You are auto-logged in to /account.',
    cta: 'Go to /signup →',
  },
  step2: {
    heading: 'Request an API key',
    body: 'Logged-in users request their own keys from /account.',
    action1: 'Open /account/keys.',
    action2: 'Click Request a key.',
    action3: 'Wait for admin approval.',
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
    example1Heading: 'no auth required — sanity check',
    example1Body: 'Status endpoint.',
    example2Heading: 'no auth required — single repo',
    example2Body: 'Public read.',
    example3Heading: 'auth required — batch',
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

  it('renders step 2 sublist with counter-reset items', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-sublist');
    expect(html).toContain('Open /account/keys');
    expect(html).toContain('Click Request a key');
    expect(html).toContain('Wait for admin approval');
  });

  it('renders step 3 callout with mono uppercase label', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());
    expect(html).toContain('ghc-getstarted-callout');
    // calloutLabel renders uppercase via CSS (text-transform); mock returns
    // the literal — assert the label structure + content.
    expect(html).toContain('ghc-getstarted-callout-label');
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