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
    title: 'Get started with the GitHub Metadata Cache API',
    description: 'A 4-step walkthrough: account, API key, first call.',
  },
  eyebrow: 'Quickstart',
  title: 'Use the API in 4 steps',
  lede: 'Walk from a brand-new visitor to a working API call.',
  step1: {
    number: '1',
    heading: 'Ask an admin for an account',
    body: 'Self-signup is not available. An admin must send you an invitation email.',
    calloutHeading: 'Already have an invite link?',
    calloutBody: 'Click the link in your invitation email to set a password and log in.',
  },
  step2: {
    number: '2',
    heading: 'Request an API key',
    body: 'Once logged in, go to /admin/api-keys and click Request.',
    action1: 'Log in at /login',
    action2: 'Visit /admin/api-keys',
    action3: 'Click Request — the key appears in your list with status pending',
  },
  step3: {
    number: '3',
    heading: 'Wait for admin approval',
    body: 'An admin reviews your request and approves it.',
    calloutHeading: 'Save the key immediately',
    calloutBody: 'The plaintext key is shown only once after approval. Copy it now.',
  },
  step4: {
    number: '4',
    heading: 'Make your first call',
    body: 'Three examples from simplest to batch.',
    example1Heading: 'No key required',
    example1Body: 'Status check.',
    example2Heading: 'No key required',
    example2Body: 'Single repo lookup.',
    example3Heading: 'Requires your API key',
    example3Body: 'Batch query.',
    errorsHeading: 'Common errors',
    errorCol: { code: 'code', status: 'HTTP', meaning: 'meaning' },
    errors: {
      unauthorized: 'Missing X-API-Key header.',
      forbidden: 'Key invalid or revoked.',
      rate_limited: 'Per-key bucket exhausted — back off.',
      not_found: 'Repo does not exist on GitHub.',
    },
  },
  deeper: {
    heading: 'Deeper reading',
    apiRef: 'Full API reference',
    apiRefBody: 'per-endpoint schemas + sample responses',
    devGuide: 'Development & contributing guide',
    devGuideBody: 'run locally, contribute',
    specBody: 'machine-readable spec',
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

// Stub CurlExample so renderToStaticMarkup can resolve the awaited async values.
vi.mock('@/app/docs/_components/curl-example', () => ({
  CurlExample: ({ method, url }: { method: string; url: string }) =>
    createElement(
      'div',
      { 'data-testid': 'curl', 'data-method': method, 'data-url': url },
      createElement('code', null, `curl ${method} ${url}`),
    ),
}));

import GetStartedPage from '@/app/get-started/page';

describe('GetStartedPage', () => {
  it('renders 4 numbered steps in order + heading + deeper-reading block', async () => {
    const html = renderToStaticMarkup(await GetStartedPage());

    // Page chrome
    expect(html).toContain('Quickstart');
    expect(html).toContain('Use the API in 4 steps');
    expect(html).toContain('Walk from a brand-new visitor');

    // Step numbers + headings (order matters)
    const stepHeadings = [
      'Ask an admin for an account',
      'Request an API key',
      'Wait for admin approval',
      'Make your first call',
    ];
    let lastIdx = -1;
    for (const heading of stepHeadings) {
      const idx = html.indexOf(heading);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }

    // Step number pills (1 / 2 / 3 / 4)
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
    expect(html).toContain('>3<');
    expect(html).toContain('>4<');

    // Three curl examples with correct methods
    expect(html).toContain('data-method="GET"');
    expect(html).toContain('data-method="POST"');

    // Error table present
    expect(html).toContain('unauthorized');
    expect(html).toContain('rate_limited');
    expect(html).toContain('not_found');
    expect(html).toContain('forbidden');

    // Deeper-reading block
    expect(html).toContain('/docs');
    expect(html).toContain('/docs/development');
    expect(html).toContain('/api-docs.json');
  });
});
