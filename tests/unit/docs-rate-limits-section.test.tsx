import { describe, it, expect, vi } from 'vitest';
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

const landingDict = flattenDict({
  heading: 'Rate limits',
  intro: 'The API uses a three-tier rate-limit model. All limits are enforced server-side.',
  tier: {
    status: {
      title: 'Public status',
      endpoint: 'GET /api/v1/status',
      per: 'No rate limit',
      body: 'Service-wide observability endpoint.',
    },
    public: {
      title: 'Public lookup',
      endpoint: 'GET /api/v1/repos/{owner}/{name}',
      per: '{limit} requests / minute / IP',
      body: 'Anonymous browsing uses PUBLIC_LOOKUP_RATE_PER_MIN (default {limit}).',
      headers: 'On 429: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining.',
    },
    auth: {
      title: 'Authenticated batch',
      endpoint: 'POST /api/query',
      per: '{limit} requests / minute / API key',
      body: 'Per-key via apiKey.rateLimitPerMin (Prisma default {limit}).',
      headers: 'On 429: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining.',
    },
  },
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'docs.landing.rateLimits': landingDict,
    };
    const t = (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
    t.rich = (key: string, chunks: Record<string, () => unknown>) => {
      const v = dicts[ns]?.[key];
      if (!v) return key;
      return v.replace(/\{(\w+)\}/g, (_, k) => String(chunks[k]?.() ?? ''));
    };
    return t;
  },
}));

import { RateLimitsSection } from '@/app/docs/_components/rate-limits-section';

describe('RateLimitsSection (M14.3)', () => {
  it('renders three tier cards with titles + endpoints', async () => {
    const html = renderToStaticMarkup(await RateLimitsSection());
    expect(html).toContain('Rate limits');
    expect(html).toContain('Public status');
    expect(html).toContain('Public lookup');
    expect(html).toContain('Authenticated batch');
    expect(html).toContain('GET /api/v1/status');
    expect(html).toContain('GET /api/v1/repos/{owner}/{name}');
    expect(html).toContain('POST /api/query');
  });

  it('interpolates env.PUBLIC_LOOKUP_RATE_PER_MIN into per + body for the public tier', async () => {
    const html = renderToStaticMarkup(await RateLimitsSection());
    // env.PUBLIC_LOOKUP_RATE_PER_MIN defaults to 30 (verified in lib/config/env.ts)
    expect(html).toContain('30 requests / minute / IP');
    expect(html).toContain('PUBLIC_LOOKUP_RATE_PER_MIN (default 30)');
  });

  it('interpolates the apiKey.rateLimitPerMin default (60) into per + body for the auth tier', async () => {
    const html = renderToStaticMarkup(await RateLimitsSection());
    expect(html).toContain('60 requests / minute / API key');
    expect(html).toContain('Per-key via apiKey.rateLimitPerMin (Prisma default 60)');
  });

  it('lists 429 response headers in public + auth cards (status card has no limit, no headers)', async () => {
    const html = renderToStaticMarkup(await RateLimitsSection());
    const headerOccurrences = html.match(
      /On 429: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining\./g,
    );
    expect(headerOccurrences?.length).toBe(2);
  });

  it('uses aria-labelledby to link the section heading to its id', async () => {
    const html = renderToStaticMarkup(await RateLimitsSection());
    expect(html).toContain('id="ghc-doc-rate-limits-heading"');
    expect(html).toContain('aria-labelledby="ghc-doc-rate-limits-heading"');
  });
});
