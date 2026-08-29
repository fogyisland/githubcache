import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock next/navigation so DocsSidebar's usePathname() returns a value that
// matches the page under test. Each test imports a different page, so we
// re-mock per test.
vi.mock('next/navigation', () => ({
  usePathname: () => '/docs',
}));

// Mock the client-side next-intl hook. <DocsSidebar> and <CopyButton>
// are 'use client' components that call useTranslations — they run in
// non-RSC render context (vitest + renderToStaticMarkup) and would throw
// "context from NextIntlClientProvider was not found" without this stub.
// Mirrors the M13 admin-shell test mock pattern.
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'docs.sidebar': {
        title: 'API',
        apiV1Status: 'GET /api/v1/status',
        apiV1Repos: 'GET /api/v1/repos/{owner}/{name}',
        apiQuery: 'POST /api/query',
      },
      'docs.copyButton': {
        copyCurl: 'Copy curl',
        copied: 'Copied!',
      },
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

// Mock next-intl/server — the docs landing page and EndpointPage call
// getTranslations inside the Vitest runtime, which lacks the Next.js
// server context next-intl requires. Mirrors the M13 admin-shell test
// mock pattern. The translation values just need to exist; the tests
// only assert HTML structure, not translated strings.
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const labels: Record<string, Record<string, string>> = {
      'docs.landing': {
        eyebrow: 'API',
        title: 'GitHub Metadata Cache API',
        lede: 'Cached GitHub repository metadata',
        'quickStart.heading': 'Quick start',
        'quickStart.body': 'Pick an endpoint below to begin.',
        'endpoints.heading': 'Endpoints',
      },
      'docs.endpointPage': {
        eyebrow: 'Endpoint',
        'sections.authentication': 'Authentication',
        'sections.rateLimit': 'Rate limit',
        'sections.request': 'Request',
        'sections.response': 'Response',
        'sections.exampleResponse': 'Example response',
        'sections.tryIt': 'Try it',
        'sections.responseHeaders': 'Response headers',
        'sections.errors': 'Errors',
        'auth.none': 'No authentication required',
        'auth.required': 'Include the {header} header on every request.',
        bodySchemaSummary: 'Request body schema',
      },
      'docs.request': {
        columns: {
          name: 'Name',
          in: 'In',
          type: 'Type',
          required: 'Required',
          description: 'Description',
        },
        yes: 'yes',
        no: 'no',
      },
      'docs.endpoint.api-v1-status': {
        summary: 'System status',
        description: 'Returns service health and observability metrics.',
        rateLimit: '60 requests per minute per IP.',
      },
      'docs.endpoint.api-v1-repos': {
        summary: 'Repository metadata',
        description: 'Returns cached GitHub repository metadata.',
        rateLimit: 'API-key tier limits apply.',
        'request.owner-description': 'Repository owner (user or org login).',
        'request.name-description': 'Repository name.',
      },
      'docs.endpoint.api-query': {
        summary: 'Multi-node lookup',
        description: 'Bulk-fetch metadata for multiple repositories.',
        rateLimit: 'X-API-Key required.',
        'request.nodes-description': 'Array of {owner, name} pairs to look up.',
      },
      'docs.copyButton': { copyCurl: 'Copy curl' },
    };
    const t = (key: string, vars?: Record<string, string | number>) => {
      const v = labels[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
    // t.rich(key, chunks) substitutes {header} etc. placeholders with the
    // React element from the matching chunk callback. The endpoint page
    // uses t.rich('auth.required', { header: ... }) for the X-API-Key hint.
    t.rich = (key: string, chunks: Record<string, React.ReactNode>) => {
      const v = labels[ns]?.[key] ?? key;
      return v.replace(/\{(\w+)\}/g, (_, k) => {
        const node = chunks[k];
        return typeof node === 'string' ? node : `{${k}}`;
      });
    };
    return t;
  },
}));

import DocsLanding from '@/app/docs/page';
import V1StatusPage from '@/app/docs/api/v1-status/page';
import V1ReposPage from '@/app/docs/api/v1-repos/page';
import QueryPage from '@/app/docs/api/query/page';

describe('/docs routes render without error', () => {
  it('/docs renders the landing page with the API title and links to all three endpoint pages', async () => {
    const el = await DocsLanding();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GitHub Metadata Cache API');
    expect(html).toContain('/docs/api/v1-status');
    expect(html).toContain('/docs/api/v1-repos');
    expect(html).toContain('/docs/api/query');
  });

  it('/docs/api/v1-status renders the GET endpoint with no-auth marker', async () => {
    const el = await V1StatusPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/status');
    expect(html).toContain('System status');
    expect(html).toContain('No authentication required');
  });

  it('/docs/api/v1-repos renders the GET endpoint with owner+name path params', async () => {
    const el = await V1ReposPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('GET');
    expect(html).toContain('/api/v1/repos/{owner}/{name}');
    expect(html).toContain('owner');
    expect(html).toContain('name');
    expect(html).toContain('No authentication required');
  });

  it('/docs/api/query renders the POST endpoint with X-API-Key auth and Retry-After header', async () => {
    const el = await QueryPage();
    const html = renderToStaticMarkup(el);
    expect(html).toContain('POST');
    expect(html).toContain('/api/query');
    expect(html).toContain('X-API-Key');
    expect(html).toContain('Retry-After');
  });
});