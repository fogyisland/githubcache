import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl/server', () => ({
  getTranslations: async (_ns: string) => (key: string, params?: Record<string, unknown>) => {
    if (key === 'showingRange' && params) {
      return `${params.start}-${params.end} of ${params.total}`;
    }
    if (key === 'pageOf' && params) {
      return `${params.page} / ${params.total}`;
    }
    return key;
  },
}));

import { AuditTable } from '@/app/admin/audit/_components/audit-table';

interface TestRow {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: unknown;
}

const sampleRow: TestRow = {
  id: '1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  action: 'user.created',
  targetType: 'user',
  targetId: '42',
  actorUserId: '7',
  actorEmail: 'admin@example.com',
  ip: '127.0.0.1',
  metadata: { foo: 'bar' },
};

describe('AuditTable prev/next pagination preserves filters', () => {
  it('includes `since` in next-page href when searchParams contain it', async () => {
    const html = renderToStaticMarkup(
      await AuditTable({
        rows: [sampleRow],
        total: 200,
        limit: 50,
        offset: 100,
        tz: 'UTC',
        searchParams: { since: '1h', limit: '50', offset: '100' },
      }),
    );
    // Next offset = 100 + 50 = 150. since=1h must survive.
    expect(html).toContain('since=1h');
    expect(html).toMatch(/href="\?[^"]*offset=150/);
  });

  it('includes all non-pagination params in both prev and next hrefs', async () => {
    const html = renderToStaticMarkup(
      await AuditTable({
        rows: [sampleRow],
        total: 200,
        limit: 50,
        offset: 100,
        tz: 'UTC',
        searchParams: {
          since: '24h',
          action: 'user.created',
          targetType: 'user',
          actorUserId: '7',
          limit: '50',
          offset: '100',
        },
      }),
    );
    // Prev: offset=50, Next: offset=150
    expect(html).toMatch(/href="\?[^"]*offset=50/);
    expect(html).toMatch(/href="\?[^"]*offset=150/);
    // Filters preserved in both links
    expect(html).toContain('since=24h');
    expect(html).toContain('action=user.created');
    expect(html).toContain('targetType=user');
    expect(html).toContain('actorUserId=7');
  });

  it('omits `offset` and `limit` from preserved entries but re-emits limit with the new offset', async () => {
    const html = renderToStaticMarkup(
      await AuditTable({
        rows: [sampleRow],
        total: 200,
        limit: 25,
        offset: 25,
        tz: 'UTC',
        searchParams: { since: '7d', limit: '25', offset: '25' },
      }),
    );
    // Next offset = 25 + 25 = 50
    expect(html).toMatch(/href="\?[^"]*offset=50/);
    // limit=25 must appear (we set it fresh per-page)
    expect(html).toContain('limit=25');
    // since=7d preserved
    expect(html).toContain('since=7d');
    // The prev/next href should NOT include an offset=25 from the old sp
    // (only the freshly-computed offset, plus the limit we set fresh)
    const nextMatch = html.match(/href="\?offset=50[^"]*"/);
    expect(nextMatch).not.toBeNull();
    expect(nextMatch![0]).not.toContain('offset=25');
  });
});
