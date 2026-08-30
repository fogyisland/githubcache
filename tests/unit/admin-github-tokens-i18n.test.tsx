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
  pool: { inPool: 'in pool', pendingActivation: 'pending activation' },
  quota: { chip: 'quota', warning: '{pct}% of combined token quota used ({used} / {limit}).' },
  poolHintPrefix: 'Pool size (currently active in memory): {size}.',
  poolHintSuffix:
    'Adding a token here creates a DB record only — to activate it, add the token to {env} env var or {envFile} and restart the service.',
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
    },
    empty: {
      title: 'No GitHub tokens registered',
      description: 'Add one with the form above to enable refresh.',
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
  pool: { inPool: 'in pool', pendingActivation: 'pending activation' },
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
  labelLabel: 'Label:',
  labelPlaceholder: 'e.g. user-ci-token',
  tokenLabel: 'Token (plaintext, will NOT be stored):',
  tokenPlaceholder: 'ghp_...',
  submit: 'Register token',
  error: { http: 'Request failed: HTTP {status}' },
  success: 'Token registered. Activate by adding to GITHUB_TOKENS env / file and restarting.',
});

const actionsDict = flattenDict({
  disable: 'Disable',
  enable: 'Enable',
  delete: 'Delete',
  confirmDelete:
    'Delete this token from the DB registry? If it is still in GITHUB_TOKENS env/file, it will re-appear on next restart.',
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
  poolHasHash: () => true,
  poolSize: () => 3,
}));

vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({ rows: [], total: 0 }),
}));

vi.mock('@/app/admin/github-tokens/_components/add-token-form', () => ({
  AddTokenForm: () => createElement('div', { 'data-testid': 'add-token-form-stub' }),
}));

vi.mock('@/app/admin/github-tokens/_components/token-actions', () => ({
  TokenActions: () => createElement('div', { 'data-testid': 'token-actions-stub' }),
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
    const html = renderToStaticMarkup(await AdminGithubTokensPage({ searchParams: {} }));
    // Page header title
    expect(html).toContain('GitHub Tokens');
    expect(html).toContain('Manage the GitHub token pool used by the refresh scheduler.');
    // Section headings
    expect(html).toContain('Add a token');
    expect(html).toContain('Registered tokens');
    // List column headers
    expect(html).toContain('>Label<');
    expect(html).toContain('>Prefix<');
    expect(html).toContain('>Status<');
    expect(html).toContain('>Pool state<');
    expect(html).toContain('>Used / Limit<');
    expect(html).toContain('>Last used<');
  });

  it('renders translated status and pool chips', async () => {
    const html = renderToStaticMarkup(await AdminGithubTokensPage({ searchParams: {} }));
    // Status chip text (from status.active)
    expect(html).toContain('>active<');
    // Pool chip text (from pool.inPool)
    expect(html).toContain('>in pool<');
  });
});

describe('AdminGithubTokenDetailPage i18n', () => {
  it('renders translated dl labels, section headings, and audit empty state', async () => {
    const html = renderToStaticMarkup(await AdminGithubTokenDetailPage({ params: { id: '1' } }));
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
