import { describe, it, expect } from 'vitest';
import { matchPaletteQuery } from '@/app/admin/_components/command-palette';
import type { PaletteSection, PaletteAuditEntry } from '@/app/admin/_components/command-palette';

describe('matchPaletteQuery', () => {
  const sections: PaletteSection[] = [
    { slug: 'users', title: 'Users', icon: 'users', href: '/admin/users' },
    { slug: 'audit', title: 'Audit log', icon: 'audit', href: '/admin/audit' },
  ];
  const audit: PaletteAuditEntry[] = [];
  const indexed = [
    { kind: 'detail' as const, label: 'User #42 — alice@example.com', href: '/admin/users/42' },
    { kind: 'detail' as const, label: 'User #99 — bob@example.com', href: '/admin/users/99' },
  ];

  it('matches section title substring', () => {
    const hits = matchPaletteQuery('audit', sections, audit, indexed);
    expect(hits.some((h) => h.kind === 'section' && h.slug === 'audit')).toBe(true);
  });

  it('matches "user 42" → User #42 detail', () => {
    const hits = matchPaletteQuery('user 42', sections, audit, indexed);
    expect(hits.some((h) => h.kind === 'detail' && h.href === '/admin/users/42')).toBe(true);
  });

  it('matches "alice" → User #42 by email substring', () => {
    const hits = matchPaletteQuery('alice', sections, audit, indexed);
    expect(hits.some((h) => h.kind === 'detail' && h.href === '/admin/users/42')).toBe(true);
  });

  it('returns empty when no match', () => {
    const hits = matchPaletteQuery('xyzzy', sections, audit, indexed);
    expect(hits).toHaveLength(0);
  });
});
