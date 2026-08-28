import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';

vi.mock('next-intl/server', () => ({
  getTranslations: async (_ns: string) => (key: string) => key,
}));

import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminEmptyState } from '@/app/admin/_components/admin-empty-state';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminKpiCard } from '@/app/admin/_components/admin-kpi-card';

describe('AdminStatusChip', () => {
  it('renders all 5 variants', () => {
    const variants = ['ok', 'warn', 'danger', 'neutral', 'info'] as const;
    for (const v of variants) {
      const html = renderToStaticMarkup(
        createElement(
          AdminStatusChip as React.ComponentType<{ variant?: 'ok' | 'warn' | 'danger' | 'neutral' | 'info' }>,
          { variant: v },
          `label-${v}`,
        ),
      );
      expect(html).toContain(`ghc-admin-chip-${v}`);
      expect(html).toContain(`label-${v}`);
    }
  });

  it('defaults to neutral variant', () => {
    const html = renderToStaticMarkup(createElement(AdminStatusChip, null, 'hello'));
    expect(html).toContain('ghc-admin-chip-neutral');
  });
});

describe('AdminEmptyState', () => {
  it('renders icon + title + description + action', () => {
    const html = renderToStaticMarkup(
      createElement(
        AdminEmptyState,
        {
          icon: createElement('span', { 'data-testid': 'icon' }, '⚙'),
          title: 'No users yet',
          description: 'Invite your first operator',
          action: createElement('a', { href: '/admin/users/invite' }, 'Invite'),
        },
      ),
    );
    expect(html).toContain('data-testid="icon"');
    expect(html).toContain('No users yet');
    expect(html).toContain('Invite your first operator');
    expect(html).toContain('>Invite<');
  });

  it('renders without description or action', () => {
    const html = renderToStaticMarkup(
      createElement(
        AdminEmptyState,
        { icon: createElement('span', null, '•'), title: 'Just a title' },
      ),
    );
    expect(html).toContain('Just a title');
    expect(html).not.toContain('ghc-admin-empty-desc');
    expect(html).not.toContain('ghc-admin-empty-action');
  });
});

describe('AdminPageHeader', () => {
  it('renders breadcrumb + title + description + actions', async () => {
    const html = renderToStaticMarkup(
      await AdminPageHeader({
        breadcrumb: [
          { label: 'Admin', href: '/admin' },
          { label: 'Users' },
        ],
        title: 'Users',
        description: 'Manage operators and admins',
        actions: createElement('button', { type: 'button' }, '+ Invite'),
      }),
    );
    expect(html).toContain('Admin');
    expect(html).toContain('Users');
    expect(html).toContain('Manage operators and admins');
    expect(html).toContain('+ Invite');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('ghc-admin-breadcrumb');
  });

  it('renders flat title when no breadcrumb', async () => {
    const html = renderToStaticMarkup(
      await AdminPageHeader({ title: 'Dashboard' }),
    );
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('ghc-admin-breadcrumb');
  });
});

describe('AdminKpiCard', () => {
  it('renders label + value + hint', () => {
    const html = renderToStaticMarkup(
      createElement(AdminKpiCard, { label: 'Cached repos', value: 1234, hint: '↑ 12 today' }),
    );
    expect(html).toContain('Cached repos');
    expect(html).toContain('1,234');
    expect(html).toContain('↑ 12 today');
  });

  it('formats numeric value with locale string', () => {
    const html = renderToStaticMarkup(
      createElement(AdminKpiCard, { label: 'Requests', value: 1234567 }),
    );
    expect(html).toContain('1,234,567');
  });

  it('accepts string value for pre-formatted strings (e.g. ms)', () => {
    const html = renderToStaticMarkup(
      createElement(AdminKpiCard, { label: 'Avg latency', value: '42 ms' }),
    );
    expect(html).toContain('42 ms');
  });

  it('uses positive tone styling when set', () => {
    const html = renderToStaticMarkup(
      createElement(AdminKpiCard, { label: 'Hit rate', value: '92%', tone: 'positive' }),
    );
    expect(html).toContain('tone-positive');
  });
});