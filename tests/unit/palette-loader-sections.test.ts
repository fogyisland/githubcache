import { describe, it, expect, vi } from 'vitest';
import type { PaletteData } from '@/app/admin/_components/command-palette';

// Mock DB so the test is hermetic — palette-loader calls `prisma.user.findMany`
// and `queryAuditLog`. We don't care about those for this assertion.
vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: vi.fn(async () => ({ rows: [], total: 0 })),
  getActorEmails: vi.fn(async () => new Map()),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => {
    return (key: string) => key; // pass-through; titles aren't asserted
  }),
}));

import { loadPaletteData } from '@/lib/admin/palette-loader';

describe('palette-loader — sections (M30.9 F1)', () => {
  it('admin sees all 18 sections', async () => {
    const data: PaletteData = await loadPaletteData('admin');
    expect(data.sections).toHaveLength(18);
    const slugs = data.sections.map((s) => s.slug).sort();
    expect(slugs).toEqual([
      'api-keys', 'api-settings', 'audit', 'dashboard',
      'database', 'email', 'email-log', 'github-tokens',
      'ingestion', 'insights', 'providers', 'queries',
      'queue', 'refresh', 'reports', 'repositories',
      'users', 'webhooks',
    ]);
  });

  it('operator sees only operator-visible sections (6 total)', async () => {
    // palette-loader applies per-section `roles` only — `reports` and
    // `queries` are inside the admin-only `system` sidebar group but
    // their section-level `roles` include 'operator', so they appear
    // in the palette. This matches existing M30 design: sidebar is
    // group-gated (4 sections), palette is section-level (6 sections).
    const data: PaletteData = await loadPaletteData('operator');
    const slugs = data.sections.map((s) => s.slug).sort();
    expect(slugs).toEqual([
      'api-keys', 'dashboard', 'github-tokens', 'queries', 'reports', 'repositories',
    ]);
  });

  it('every section has a non-empty title, icon, href', async () => {
    const data = await loadPaletteData('admin');
    for (const s of data.sections) {
      expect(s.slug).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.icon).toBeTruthy();
      expect(s.href).toMatch(/^\/admin/);
    }
  });
});
