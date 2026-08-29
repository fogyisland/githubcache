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

const userDict = flattenDict({
  title: 'Users',
  description: 'desc',
  breadcrumbAdmin: 'Admin',
  breadcrumbUsers: 'Users',
  role: { admin: 'admin', operator: 'operator' },
  status: { active: 'active', disabled: 'disabled', pending: 'pending' },
  list: {
    inviteHeading: 'Invite a user',
    existingHeading: 'Existing users',
    pendingHeading: 'Pending invitations',
    never: 'never',
    ariaLabel: 'Existing users',
    pendingAriaLabel: 'Pending invitations',
    filter: { role: 'Role', status: 'Status' },
    column: {
      email: 'Email',
      role: 'Role',
      status: 'Status',
      lastLogin: 'Last login',
      created: 'Created',
      invitedBy: 'Invited by',
      expires: 'Expires',
      inviteLink: 'Invite link',
    },
    empty: { title: 'No users match', description: 'Try clearing' },
    pendingEmpty: { title: 'No pending', description: 'Send one' },
  },
  inviteLinkPrefix: '/request-access?invitation={id}',
});

const detailDict = flattenDict({
  description: 'detail desc',
  breadcrumbAdmin: 'Admin',
  breadcrumbUsers: 'Users',
  role: { admin: 'admin', operator: 'operator' },
  status: { active: 'active', disabled: 'disabled', pending: 'pending' },
  actionsHeading: 'Actions',
  keysHeading: 'API keys owned',
  auditHeading: 'Recent activity',
  keysEmpty: { title: 'No API keys', description: 'None' },
  auditEmpty: { title: 'No recent activity' },
  keysAriaLabel: 'API keys owned',
  auditAriaLabel: 'Recent audit entries',
  keyColumns: { name: 'Name', prefix: 'Prefix', status: 'Status', created: 'Created' },
  auditColumns: { when: 'When', action: 'Action' },
  profile: {
    role: 'Role',
    status: 'Status',
    created: 'Created',
    lastLogin: 'Last login',
    activeSessions: 'Active sessions',
    adminVariant: 'Admin variant',
    theme: 'Theme',
    never: 'never',
  },
});

const inviteDict = flattenDict({
  emailPlaceholder: 'email@example.com',
  role: { operator: 'Operator', admin: 'Admin' },
  submit: 'Send invitation',
  error: { http: 'HTTP {status}' },
  linkLabel: 'Invitation link',
});

const actionsDict = flattenDict({
  resetPassword: 'Reset password',
  disable: 'Disable',
  enable: 'Enable',
  logoutAll: 'Logout all sessions',
  confirmLogoutAll: 'Log out all?',
  confirmResetPassword: 'Reset?',
  failedWithStatus: 'Failed: HTTP {status}',
  disabledOk: 'User disabled',
  enabledOk: 'User enabled',
  loggedOutCount: 'Logged out {count} sessions',
  tempPasswordMessage: 'Temp: {password}',
});

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'admin.users': userDict,
      'admin.users.detail': detailDict,
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
      'admin.users.invite': inviteDict,
      'admin.users.actions': actionsDict,
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

vi.mock('@/lib/db/users', () => ({
  listUsers: async () => ({ rows: [], total: 0 }),
  getUserById: async () => ({
    id: 1n,
    email: 'op@test.com',
    role: 'operator',
    status: 'active',
    adminVariant: 'mission_control',
    theme: 'terminal',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: new Date('2026-08-01'),
    passwordHash: '',
  }),
}));

vi.mock('@/lib/db/invitations', () => ({
  listInvitations: async () => [],
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    session: { count: async () => 0 },
    apiKey: { findMany: async () => [] },
  },
}));

vi.mock('@/lib/db/audit', () => ({
  queryAuditLog: async () => ({ rows: [], total: 0 }),
}));

vi.mock('./_components/invite-form', () => ({
  InviteForm: () => createElement('div', { 'data-testid': 'invite-form-stub' }),
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

import AdminUsersPage from '@/app/admin/users/page';

describe('AdminUsersPage i18n', () => {
  it('renders translated section headings, filter labels, and empty states', async () => {
    const html = renderToStaticMarkup(await AdminUsersPage({ searchParams: {} }));
    // Page header title
    expect(html).toContain('Users');
    // Section headings
    expect(html).toContain('Existing users');
    expect(html).toContain('Pending invitations');
    expect(html).toContain('Invite a user');
    // Filter labels
    expect(html).toContain('>Role<');
    expect(html).toContain('>Status<');
    // Empty states (since users/invitations are mocked empty)
    expect(html).toContain('No users match');
    expect(html).toContain('Try clearing');
    expect(html).toContain('No pending');
    expect(html).toContain('Send one');
  });
});
