import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactNode } from 'react';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (ns: string) => {
    const t = ((key: string, values?: Record<string, string | number | ((chunks: ReactNode) => ReactNode)>) => {
      const dict: Record<string, string> = {
        'docs.landing.eyebrow': 'API Reference',
        'docs.landing.title': 'GitHub Metadata Cache API',
        'docs.landing.lede': 'Public, cache-backed access to GitHub repository metadata.',
        'docs.landing.quickStart.heading': 'Quick start',
        'docs.landing.quickStart.body': 'Hit the public status endpoint first — no auth required:',
        'docs.landing.endpoints.heading': 'Endpoints',
        // M14.3 — rate-limits explainer
        'docs.landing.rateLimits.heading': 'Rate limits',
        'docs.landing.rateLimits.intro': 'Three-tier rate-limit model.',
        'docs.landing.rateLimits.tier.status.title': 'Public status',
        'docs.landing.rateLimits.tier.status.endpoint': 'GET /api/v1/status',
        'docs.landing.rateLimits.tier.status.per': 'No rate limit',
        'docs.landing.rateLimits.tier.status.body': 'Service-wide observability.',
        'docs.landing.rateLimits.tier.public.title': 'Public lookup',
        'docs.landing.rateLimits.tier.public.endpoint': 'GET /api/v1/repos/{owner}/{name}',
        'docs.landing.rateLimits.tier.public.per': '{limit} req/min/IP',
        'docs.landing.rateLimits.tier.public.body': 'PUBLIC_LOOKUP_RATE_PER_MIN default {limit}.',
        'docs.landing.rateLimits.tier.public.headers': 'On 429: Retry-After.',
        'docs.landing.rateLimits.tier.auth.title': 'Authenticated batch',
        'docs.landing.rateLimits.tier.auth.endpoint': 'POST /api/query',
        'docs.landing.rateLimits.tier.auth.per': '{limit} req/min/key',
        'docs.landing.rateLimits.tier.auth.body': 'apiKey.rateLimitPerMin default {limit}.',
        'docs.landing.rateLimits.tier.auth.headers': 'On 429: Retry-After.',
        // M14.3 — live status widget
        'docs.landing.liveStatus.heading': 'Live status',
        'docs.landing.liveStatus.body': 'Snapshot rendered on this page.',
        'docs.landing.liveStatus.fields.ok': 'Service',
        'docs.landing.liveStatus.fields.db': 'Database',
        'docs.landing.liveStatus.fields.tokensActive': 'Active tokens',
        'docs.landing.liveStatus.fields.tokensExhausted': 'Exhausted',
        'docs.landing.liveStatus.fields.queuePending': 'Queue pending',
        'docs.landing.liveStatus.fields.queueFailed': 'Queue failed',
        'docs.landing.liveStatus.fields.reposTotal': 'Repositories',
        'docs.landing.liveStatus.values.up': 'up',
        'docs.landing.liveStatus.values.down': 'down',
        'docs.endpointPage.eyebrow': 'Endpoint',
        'docs.endpointPage.auth.none': 'No authentication required. Public endpoint.',
        'docs.endpointPage.auth.required': 'Requires the {header} header with an active API key.',
        'docs.endpointPage.sections.authentication': 'Authentication',
        'docs.endpointPage.sections.rateLimit': 'Rate limit',
        'docs.endpointPage.sections.request': 'Request',
        'docs.endpointPage.sections.response': 'Response',
        'docs.endpointPage.sections.exampleResponse': 'Example response',
        'docs.endpointPage.sections.tryIt': 'Try it',
        'docs.endpointPage.sections.responseHeaders': 'Response headers',
        'docs.endpointPage.sections.errors': 'Errors',
        'docs.endpointPage.bodySchemaSummary': 'Body schema',
        'docs.request.columns.name': 'Name',
        'docs.request.columns.in': 'In',
        'docs.request.columns.type': 'Type',
        'docs.request.columns.required': 'Required',
        'docs.request.columns.description': 'Description',
        'docs.request.yes': 'yes',
        'docs.request.no': 'no',
        'docs.headers.columns.header': 'Header',
        'docs.headers.columns.description': 'Description',
        'docs.headers.columns.example': 'Example',
        'docs.headers.empty': 'No documented headers.',
        'docs.errors.columns.status': 'Status',
        'docs.errors.columns.error': 'Error',
        'docs.errors.columns.when': 'When',
        'docs.errors.empty': 'No documented errors.',
        'docs.schema.columns.name': 'Name',
        'docs.schema.columns.type': 'Type',
        'docs.schema.columns.description': 'Description',
        'docs.schema.badges.optional': '(optional)',
        'docs.schema.badges.nullable': '(nullable)',
        'docs.schema.scalar.array': '(array)',
        'docs.copyButton.copy': 'Copy',
        'docs.copyButton.copyCurl': 'Copy curl',
        'docs.copyButton.copied': 'Copied!',
        'docs.endpoint.api-v1-status.summary': 'System status — DB, token pool, queue, repository counts, version.',
        'docs.endpoint.api-v1-status.description': 'Read-only observability endpoint. Always public, no rate limit.',
        'docs.endpoint.api-v1-status.rateLimit': 'No rate limit.',
        'docs.endpoint.api-v1-repos.summary': 'Fetch a single repository metadata record from the cache.',
        'docs.endpoint.api-v1-repos.description': 'Public read of the cache for a single repo.',
        'docs.endpoint.api-v1-repos.rateLimit': 'PUBLIC_LOOKUP_RATE_PER_MIN (default 30) per IP',
        'docs.endpoint.api-query.summary': 'Batch-fetch up to 50 repositories with a single API key.',
        'docs.endpoint.api-query.description': 'Authenticated batch endpoint for API key holders.',
        'docs.endpoint.api-query.rateLimit': 'rateLimitPerMin (per API key, default 60) durable bucket',
        // M15 — /docs page sections (download spec, how caching works, error codes)
        'docs.landing.downloadSpec.heading': 'Download API spec',
        'docs.landing.downloadSpec.body': 'A machine-readable summary of every public endpoint.',
        'docs.landing.downloadSpec.copyCurl': 'Copy cURL',
        'docs.landing.downloadSpec.copied': 'Copied',
        'docs.landing.downloadSpec.fetch': 'Fetch /api-docs.json',
        'docs.landing.howCachingWorks.heading': 'How caching works',
        'docs.landing.howCachingWorks.intro': 'Every public endpoint reads through the same cache+scheduler pipeline.',
        'docs.landing.howCachingWorks.steps.step1': 'Client hits an API endpoint.',
        'docs.landing.howCachingWorks.steps.step2': 'Server checks the local cache.',
        'docs.landing.howCachingWorks.steps.step3': 'On miss, queue a refresh and wait for the first response.',
        'docs.landing.howCachingWorks.steps.step4': 'A background scheduler drains the refresh queue.',
        'docs.landing.howCachingWorks.steps.step5': 'If GitHub is unreachable, serve the most recent cached row.',
        'docs.landing.errorCodes.heading': 'Error codes',
        'docs.landing.errorCodes.intro': 'Every 4xx/5xx response carries a machine-readable code.',
        'docs.landing.errorCodes.columns.code': 'Code',
        'docs.landing.errorCodes.columns.status': 'HTTP',
        'docs.landing.errorCodes.columns.retry': 'Retry?',
        'docs.landing.errorCodes.columns.description': 'Description',
        'docs.landing.errorCodes.retry.no': 'no',
        'docs.landing.errorCodes.retry.after': 'after {seconds}s',
        'docs.landing.errorCodes.retry.later': 'later',
        'docs.landing.errorCodes.codes.bad_request': 'Request body or parameters failed validation.',
        'docs.landing.errorCodes.codes.unauthorized': 'Authentication header missing or malformed.',
        'docs.landing.errorCodes.codes.forbidden': 'Credentials valid but caller lacks permission.',
        'docs.landing.errorCodes.codes.not_found': 'The requested resource does not exist.',
        'docs.landing.errorCodes.codes.conflict': 'The request conflicts with current state.',
        'docs.landing.errorCodes.codes.rate_limited': 'Rate limit exceeded.',
        'docs.landing.errorCodes.codes.internal_error': 'Server-side failure.',
        'docs.landing.errorCodes.codes.unavailable': 'Service is down or dependency unreachable.',
      };
      let s = dict[`${ns}.${key}`];
      if (s === undefined) {
        // Mimic next-intl behavior: throw on missing keys so try/catch in
        // component code falls back to the raw registry value.
        throw new Error(`MISSING_MESSAGE: ${ns}.${key}`);
      }
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          if (typeof v === 'function') continue;
          s = s.replaceAll(`{${k}}`, String(v));
        }
      }
      return s;
    }) as ((key: string, values?: Record<string, string | number | ((chunks: ReactNode) => ReactNode)>) => string) & {
      rich: (key: string, values: Record<string, string | ((chunks: ReactNode) => ReactNode)>) => ReactNode;
    };
    t.rich = (key: string, values: Record<string, string | ((chunks: ReactNode) => ReactNode)>): ReactNode => {
      const s = 'Requires the {header} header with an active API key.';
      // Split the string by the {header} placeholder and interleave the chunks call.
      const parts = s.split('{header}');
      const headerFn = values.header;
      const headerChunk = typeof headerFn === 'function' ? headerFn('X-API-Key') : headerFn;
      return createElement('span', null, parts[0], headerChunk, parts[1]);
    };
    return t;
  }),
}));
vi.mock('next-intl', () => ({
  useTranslations: vi.fn((ns: string) => (key: string) => `[${ns}.${key}]`),
}));

// M14.3 — the live status widget calls collectV1Status() which hits the DB.
// Stub it to a healthy payload so the docs landing render doesn't need a
// real DB connection in this unit test.
vi.mock('@/lib/api-docs/v1-status', () => ({
  collectV1Status: vi.fn(async () => ({
    ok: true,
    db: 'up',
    tokens: { active: 3, exhausted: 0, total: 4 },
    queue: { pending: 0, in_progress: 0, done: 12, failed: 0 },
    repositories: { total: 46, ok: 42, not_found: 3, forbidden: 0, error: 1 },
    version: { commit: 'abc', startedAt: '2026-01-01', nodeVersion: 'v20' },
    timestamp: '2026-01-01',
  })),
}));

import DocsLanding from '@/app/docs/page';
import { EndpointPage } from '@/app/docs/_components/endpoint-page';
import { HeadersTable } from '@/app/docs/_components/headers-table';
import { ErrorsTable } from '@/app/docs/_components/errors-table';
import { findEndpointBySlug } from '@/lib/api-docs/registry';

describe('docs i18n', () => {
  it('landing page renders translated chrome', async () => {
    const html = renderToStaticMarkup(await DocsLanding());
    expect(html).toContain('API Reference');
    expect(html).toContain('GitHub Metadata Cache API');
    expect(html).toContain('Quick start');
    expect(html).toContain('Endpoints');
  });

  it('endpoint page renders translated sections', async () => {
    const doc = findEndpointBySlug('api/v1-status');
    if (!doc) throw new Error('fixture missing');
    const html = renderToStaticMarkup(await EndpointPage({ doc }));
    expect(html).toContain('Endpoint');
    expect(html).toContain('Authentication');
    expect(html).toContain('Rate limit');
    expect(html).toContain('Response');
    expect(html).toContain('Example response');
    expect(html).toContain('Try it');
    expect(html).toContain('Errors');
    expect(html).toContain('No authentication required. Public endpoint.');
  });

  it('api-key endpoint renders required auth message', async () => {
    const doc = findEndpointBySlug('api/query');
    if (!doc) throw new Error('fixture missing');
    const html = renderToStaticMarkup(await EndpointPage({ doc }));
    expect(html).toContain('X-API-Key');
    expect(html).toContain('Request');
    expect(html).toContain('Body schema');
    expect(html).toContain('Response headers');
  });

  it('request table column headers are translated', async () => {
    const doc = findEndpointBySlug('api/v1-repos');
    if (!doc) throw new Error('fixture missing');
    const html = renderToStaticMarkup(await EndpointPage({ doc }));
    expect(html).toContain('Name');
    expect(html).toContain('In');
    expect(html).toContain('Type');
    expect(html).toContain('Required');
    expect(html).toContain('Description');
    expect(html).toContain('yes');
    expect(html).toContain('no');
  });

  it('headers table renders translated columns', async () => {
    const html = renderToStaticMarkup(await HeadersTable({
      headers: [
        { name: 'Retry-After', description: 'fallback', example: '30' },
      ],
      endpointNs: 'api-query',
    }));
    expect(html).toContain('Header');
    expect(html).toContain('Description');
    expect(html).toContain('Example');
  });

  it('errors table renders translated columns and translated when', async () => {
    const html = renderToStaticMarkup(await ErrorsTable({
      errors: [
        { status: 429, code: 'rate_limited', error: 'rate limit exceeded', when: 'fallback when' },
      ],
      endpointNs: 'api-query',
    }));
    expect(html).toContain('Status');
    expect(html).toContain('Error');
    expect(html).toContain('When');
    // The mock's dict doesn't have `docs.endpoint.api-query.errors.429-rate_limit_exceeded`,
    // so the fallback `when` string should be rendered.
    expect(html).toContain('fallback when');
  });

  it('errors table empty state is translated', async () => {
    const html = renderToStaticMarkup(await ErrorsTable({ errors: [], endpointNs: 'api-v1-status' }));
    expect(html).toContain('No documented errors.');
  });
});
