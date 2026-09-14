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

const githubTokensDict = flattenDict({
  title: 'GitHub Tokens',
  description: 'Manage the GitHub token pool used by the refresh scheduler.',
  breadcrumbAdmin: 'Admin',
  breadcrumbGithubTokens: 'GitHub Tokens',
  addHeading: 'Add a token',
  status: { active: 'active', disabled: 'disabled' },
  pool: { inPool: 'in pool', notInPool: 'not in pool' },
  quota: { heading: 'Pool quota', warning: '{pct}% of combined token quota used ({used} / {limit}).' },
  list: {
    heading: 'Registered tokens',
    ariaLabel: 'GitHub tokens',
    never: 'never',
    column: {
      label: 'Label',
      prefix: 'Prefix',
      status: 'Status',
      poolState: 'Pool state',
      usedLimit: 'Used / Limit',
      lastUsed: 'Last used',
      test: 'Test',
    },
    empty: {
      title: 'No GitHub tokens registered',
      description: 'Add one with the form below to enable refresh.',
    },
  },
});

const detailDict = flattenDict({
  breadcrumbAdmin: 'Admin',
  breadcrumbGithubTokens: 'GitHub Tokens',
  tokenPrefix: 'Token {first4}…{last4}',
  actionsHeading: 'Actions',
  auditHeading: 'Recent activity',
  auditEmpty: { title: 'No recent activity for this token' },
  auditAriaLabel: 'Recent audit entries for this GitHub token',
  auditColumns: { when: 'When', action: 'Action' },
  status: { active: 'active', disabled: 'disabled' },
  pool: { inPool: 'in pool', notInPool: 'not in pool' },
  profile: {
    prefix: 'Prefix',
    fullTokenHidden: '(full token never stored)',
    status: 'Status',
    poolState: 'Pool state',
    usage: 'Usage',
    lastUsed: 'Last used',
    never: 'never',
    resetWindow: 'Reset window',
    dash: '—',
    created: 'Created',
  },
});

const addFormDict = flattenDict({
  labelLabel: 'Label',
  labelPlaceholder: 'e.g. user-ci-token',
  tokenLabel: 'Token (plaintext, stored in DB — revoke on GitHub if leaked):',
  tokenPlaceholder: 'ghp_...',
  submit: 'Register token',
  error: { http: 'Request failed: HTTP {status}' },
  success: 'Token registered and added to the pool.',
});

const actionsDict = flattenDict({
  disable: 'Disable',
  enable: 'Enable',
  delete: 'Delete',
  confirmDelete:
    'Delete this token from the registry and remove it from the pool? It will stop taking effect immediately.',
  failedWithError: 'Failed: {error}',
  disabledOk: 'Token disabled (takes effect on next service restart).',
  enabledOk: 'Token enabled.',
  deletedOk: 'Token deleted from DB registry.',
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.githubTokens': githubTokensDict,
      'admin.githubTokens.detail': detailDict,
    };
    const t = (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) {
        return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      }
      return v ?? key;
    };
    t.rich = (key: string, chunks: Record<string, () => unknown>) => {
      const v = dicts[ns]?.[key];
      if (!v) return key;
      // Simple replacement: replace {name} with the chunk's string representation
      return v.replace(/\{(\w+)\}/g, (_, k) => {
        const chunk = chunks[k];
        if (chunk) {
          // Render a simple string from React element if present
          return String(chunk);
        }
        return '';
      });
    };
    return t;
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.githubTokens.addForm': addFormDict,
      'admin.githubTokens.actions': actionsDict,
    };
    return (key: string, vars?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && vars) return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
      return v ?? key;
    };
  },
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
  headers: () => ({ get: () => null }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: async () => 'csrf-stub',
}));

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => ({
    id: 1n,
    email: 'admin@test.com',
    role: 'admin',
    status: 0,
    adminVariant: 'mission_control',
    theme: 'terminal',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: null,
    passwordHash: '',
  }),
}));

vi.mock('@/lib/db/github-tokens', () => ({
  listAllTokens: async () => ({
    rows: [
      {
        id: 1n,
        label: 'ci-token-1',
        tokenHash: 'hash1',
        tokenFirst4: 'ghp1',
        tokenLast4: 'wxyz',
        status: 'active',
        requestsUsed: 100,
        requestsLimit: 5000,
        resetAt: null,
        lastUsedAt: new Date('2026-08-15T10:30:00Z'),
        createdAt: new Date('2026-08-01T12:00:00Z'),
      },
    ],
    total: 1,
  }),
  getTokenById: async () => ({
    id: 1n,
    label: 'ci-token-1',
    tokenHash: 'hash1',
    tokenFirst4: 'ghp1',
    tokenLast4: 'wxyz',
    status: 'active',
    requestsUsed: 100,
    requestsLimit: 5000,
    resetAt: null,
    lastUsedAt: new Date('2026-08-15T10:30:00Z'),
    createdAt: new Date('2026-08-01T12:00:00Z'),
  }),
}));

vi.mock('@/lib/github/pool', () => ({
  poolHasId: () => true,
  poolSize: () => 3,
}));

vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({ rows: [], total: 0 }),
}));

vi.mock('@/app/admin/github-tokens/_components/add-token-form', () => ({
  AddTokenForm: () => createElement('div', { 'data-testid': 'add-token-form-stub' }),
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

import AdminGithubTokensPage from '@/app/admin/github-tokens/page';
import AdminGithubTokenDetailPage from '@/app/admin/github-tokens/[id]/page';

describe('AdminGithubTokensPage i18n', () => {
  it('renders translated title, description, and section headings', async () => {
    const html = renderToStaticMarkup(await AdminGithubTokensPage({ searchParams: Promise.resolve({}) }));
    // Page header title
    expect(html).toContain('GitHub Tokens');
    expect(html).toContain('Manage the GitHub token pool used by the refresh scheduler.');
    // Section headings
    expect(html).toContain('Add a token');
    expect(html).toContain('Registered tokens');
    // Terminal row contents (the column headers from the old AdminTable
    // are gone — TokenRow is a flex-grid, not a table; only row cells).
    expect(html).toContain('ci-token-1'); // label
    expect(html).toContain('ghp1'); // prefix first4
    expect(html).toContain('wxyz'); // prefix last4
    expect(html).toContain('Status'); // aria-label on the status span
    expect(html).toContain('100 / 5,000'); // usage cell
    expect(html).toContain('2026-08-15'); // last-used date
  });

  it('renders translated section headings + AdminTable status chip + ghc-btn action buttons', async () => {
    const html = renderToStaticMarkup(await AdminGithubTokensPage({ searchParams: Promise.resolve({}) }));
    // Section heading "Pool quota" from t('quota.heading')
    expect(html).toContain('Pool quota');
    // AdminTable column headers — translated
    expect(html).toContain('Label');
    expect(html).toContain('Prefix');
    expect(html).toContain('Status');
    expect(html).toContain('Pool state');
    expect(html).toContain('Used / Limit');
    // Status chip content (active token has "active" label inside chip)
    expect(html).toContain('active');
    // Action buttons (M32.5: ghc-btn-* instead of [d]/[E]/[x] keycaps)
    expect(html).toContain('Disable');
    expect(html).toContain('Delete');
  });
});

describe('AdminGithubTokenDetailPage i18n', () => {
  it('renders translated dl labels, section headings, and audit empty state', async () => {
    const html = renderToStaticMarkup(await AdminGithubTokenDetailPage({ params: Promise.resolve({ id: '1' }) }));
    // Page header description (interpolated first4/last4)
    expect(html).toContain('Token ghp1…wxyz');
    // dl labels
    expect(html).toContain('>Prefix<');
    expect(html).toContain('>(full token never stored)<');
    expect(html).toContain('>Status<');
    expect(html).toContain('>Pool state<');
    expect(html).toContain('>Usage<');
    expect(html).toContain('>Last used<');
    expect(html).toContain('>Reset window<');
    expect(html).toContain('>Created<');
    // Section headings
    expect(html).toContain('>Actions<');
    expect(html).toContain('Recent activity');
    // Audit empty state
    expect(html).toContain('No recent activity for this token');
  });
});
