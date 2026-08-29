import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const liveStatusDict = flattenDict({
  heading: 'Live status',
  body: 'Snapshot of /api/v1/status rendered on this page at request time.',
  fields: {
    ok: 'Service',
    db: 'Database',
    tokensActive: 'Active tokens',
    tokensExhausted: 'Exhausted',
    queuePending: 'Queue pending',
    queueFailed: 'Queue failed',
    reposTotal: 'Repositories',
  },
  values: { up: 'up', down: 'down' },
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'docs.landing.liveStatus': liveStatusDict,
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

const mockCollect = vi.fn();
vi.mock('@/lib/api-docs/v1-status', () => ({
  collectV1Status: () => mockCollect(),
}));

import { LiveStatusWidget } from '@/app/docs/_components/live-status-widget';

describe('LiveStatusWidget (M14.3)', () => {
  beforeEach(() => {
    mockCollect.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders 7 fields with values when the service is healthy', async () => {
    mockCollect.mockResolvedValueOnce({
      ok: true,
      db: 'up',
      tokens: { active: 3, exhausted: 1, total: 4 },
      queue: { pending: 2, in_progress: 0, done: 12, failed: 0 },
      repositories: { total: 46, ok: 42, not_found: 3, forbidden: 0, error: 1 },
      version: { commit: 'abc123', startedAt: '2026-08-27T00:00:00Z', nodeVersion: 'v20.10.0' },
      timestamp: '2026-08-27T12:00:00Z',
    });
    const html = renderToStaticMarkup(await LiveStatusWidget());
    expect(html).toContain('Live status');
    expect(html).toContain('Service');
    expect(html).toContain('up');
    expect(html).toContain('Database');
    expect(html).toContain('Active tokens');
    expect(html).toContain('>3<'); // active tokens
    expect(html).toContain('>1<'); // exhausted
    expect(html).toContain('>2<'); // queue pending
    expect(html).toContain('>46<'); // repos total
  });

  it('links every field to /api/v1/status JSON', async () => {
    mockCollect.mockResolvedValueOnce({
      ok: true,
      db: 'up',
      tokens: { active: 0, exhausted: 0, total: 0 },
      queue: { pending: 0, in_progress: 0, done: 0, failed: 0 },
      repositories: { total: 0, ok: 0, not_found: 0, forbidden: 0, error: 0 },
      version: { commit: 'x', startedAt: 'x', nodeVersion: 'x' },
      timestamp: 'x',
    });
    const html = renderToStaticMarkup(await LiveStatusWidget());
    // 7 fields × 1 anchor each
    const matches = html.match(/href="\/api\/v1\/status"/g);
    expect(matches?.length).toBe(7);
  });

  it('renders degraded badge when DB is unreachable', async () => {
    mockCollect.mockResolvedValueOnce(null);
    const html = renderToStaticMarkup(await LiveStatusWidget());
    expect(html).toContain('Live status');
    expect(html).toContain('down');
    // No numeric fields rendered in degraded mode
    expect(html).not.toContain('Active tokens');
    expect(html).not.toContain('Queue pending');
  });

  it('uses aria-labelledby to link the section heading to its id', async () => {
    mockCollect.mockResolvedValueOnce(null);
    const html = renderToStaticMarkup(await LiveStatusWidget());
    expect(html).toContain('id="ghc-doc-live-status-heading"');
    expect(html).toContain('aria-labelledby="ghc-doc-live-status-heading"');
  });
});
