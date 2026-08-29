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

const apiKeysDict = flattenDict({
  title: 'API Keys',
  description: 'Issue, approve, and revoke API keys.',
  breadcrumbAdmin: 'Admin',
  breadcrumbApiKeys: 'API Keys',
  role: { admin: 'admin', operator: 'operator' },
  status: { pending: 'pending', active: 'active', revoked: 'revoked' },
  common: { dash: '—' },
  list: {
    ariaLabel: 'API keys',
    never: 'never',
    filter: { status: 'Status' },
    column: {
      name: 'Name',
      prefix: 'Prefix',
      owner: 'Owner',
      status: 'Status',
      rate: 'Rate/min',
      quota: 'Daily quota',
      lastUsed: 'Last used',
    },
    empty: { title: 'No API keys match', description: 'Try clearing the filter' },
  },
});

const detailDict = flattenDict({
  breadcrumbAdmin: 'Admin',
  breadcrumbApiKeys: 'API Keys',
  ownedBy: 'Owned by {email} ({role})',
  role: { admin: 'admin', operator: 'operator' },
  status: { pending: 'pending', active: 'active', revoked: 'revoked' },
  actionsHeading: 'Actions',
  limitsHeading: 'Limits',
  auditHeading: 'Recent activity',
  auditEmpty: { title: 'No recent activity for this key' },
  auditAriaLabel: 'Recent audit entries for this API key',
  auditColumns: { when: 'When', action: 'Action' },
  profile: {
    prefix: 'Prefix',
    fullKeyHidden: '(full key never displayed)',
    status: 'Status',
    created: 'Created',
    approved: 'Approved',
    approvedAt: '{datetime} by {approver}',
    revoked: 'Revoked',
    lastUsed: 'Last used',
    never: 'never',
    requests24h: 'Requests (24h)',
    rateLimit: 'Rate limit',
    rateLimitValue: '{rate}/min · {quota}/day',
  },
});

const actionsDict = flattenDict({
  approve: 'Approve',
  revoke: 'Revoke',
  alreadyRevoked: 'Already revoked.',
  confirmRevoke: 'Revoke this key? It will stop working immediately.',
  approveFailed: 'Approve failed: {error}',
  revokeFailed: 'Revoke failed: {error}',
  approvedOk: 'Approved.',
  revokedOk: 'Revoked.',
});

const limitsDict = flattenDict({
  rateLimitLabel: 'Rate limit per min:',
  dailyQuotaLabel: 'Daily quota:',
  save: 'Save limits',
  updatedOk: 'Limits updated.',
  failedWithError: 'Failed: {error}',
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.apiKeys': apiKeysDict,
      'admin.apiKeys.detail': detailDict,
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) {
        return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      }
      return v ?? key;
    };
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.apiKeys.actions': actionsDict,
      'admin.apiKeys.limits': limitsDict,
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: 1n,
    email: 'admin@test.com',
    role: 'admin',
    status: 'active',
    adminVariant: 'mission_control',
    theme: 'terminal',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: null,
    passwordHash: '',
  }),
}));

vi.mock('@/lib/db/api-keys', () => ({
  listApiKeys: async () => ({ rows: [], total: 0 }),
  getApiKeyById: async () => ({
    id: 1n,
    name: 'Test Key',
    keyPrefix: 'abc12345',
    userId: 1n,
    status: 'active',
    rateLimitPerMin: 60,
    dailyQuota: 1000,
    createdAt: new Date('2026-08-01T12:00:00Z'),
    approvedAt: new Date('2026-08-02T10:00:00Z'),
    approvedBy: 1n,
    revokedAt: null,
    lastUsedAt: null,
    keyHash: 'hash',
    requestCountLast24h: 42,
    user: { id: 1n, email: 'op@test.com', role: 'operator' },
  }),
}));

vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({ rows: [], total: 0 }),
}));

vi.mock('@/app/admin/api-keys/[id]/_components/limits-form', () => ({
  LimitsForm: () => createElement('div', { 'data-testid': 'limits-form-stub' }),
}));

vi.mock('@/app/admin/api-keys/[id]/_components/key-actions', () => ({
  KeyActions: () => createElement('div', { 'data-testid': 'key-actions-stub' }),
}));

vi.mock('@/app/admin/_components/admin-page-header', () => ({
  AdminPageHeader: ({ title, description }: { title: string; description?: string }) =>
    createElement(
      'div',
      { 'data-testid': 'page-header-stub' },
      createElement('h1', null, title),
      description ? createElement('p', null, description) : null,
    ),
}));

import AdminApiKeysPage from '@/app/admin/api-keys/page';
import AdminApiKeyDetailPage from '@/app/admin/api-keys/[id]/page';

describe('AdminApiKeysPage i18n', () => {
  it('renders translated filter labels and empty state (no rows mock)', async () => {
    const html = renderToStaticMarkup(await AdminApiKeysPage({ searchParams: {} }));
    // Page header title
    expect(html).toContain('API Keys');
    expect(html).toContain('Issue, approve, and revoke API keys.');
    // Filter label (rendered in AdminFilterBar)
    expect(html).toContain('Status');
    // Status option labels (rendered in filter)
    expect(html).toContain('>pending<');
    expect(html).toContain('>active<');
    expect(html).toContain('>revoked<');
    // Empty state (keys mocked empty)
    expect(html).toContain('No API keys match');
    expect(html).toContain('Try clearing the filter');
  });
});

describe('AdminApiKeyDetailPage i18n', () => {
  it('renders translated dl labels, section headings, and description', async () => {
    const html = renderToStaticMarkup(await AdminApiKeyDetailPage({ params: { id: '1' } }));
    // Page header title (key name) and description (with interpolated role)
    expect(html).toContain('Test Key');
    expect(html).toContain('Owned by op@test.com (operator)');
    // dl labels
    expect(html).toContain('>Prefix<');
    expect(html).toContain('>(full key never displayed)<');
    expect(html).toContain('>Status<');
    expect(html).toContain('>Created<');
    expect(html).toContain('>Approved<');
    expect(html).toContain('>Revoked<');
    expect(html).toContain('>Last used<');
    expect(html).toContain('>Requests (24h)<');
    expect(html).toContain('>Rate limit<');
    // Section headings
    expect(html).toContain('>Limits<');
    expect(html).toContain('>Actions<');
    expect(html).toContain('Recent activity');
    // Audit empty state
    expect(html).toContain('No recent activity for this key');
  });
});
