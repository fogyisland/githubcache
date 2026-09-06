import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/password';
import { generateSessionId } from '@/lib/db/sessions';
import type { User } from '@prisma/client';

const TEST_EMAIL_PREFIX = 'account-keys-int-';
const TEST_EMAIL = `${TEST_EMAIL_PREFIX}user-${Date.now()}@example.test`;
const TEST_PASSWORD = 'supersecret1';

let operator: User;
let sessionId: string;

// Static fixtures used by the mocked modules below.
const MOCKED_SESSION_USER: User = {
  id: 0n, // overwritten below
  email: TEST_EMAIL,
  passwordHash: 'x',
  role: 'operator',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  lastLoginAt: null,
  theme: 'terminal',
  adminVariant: 'mission_control',
  lang: 'en',
  timezone: 'UTC',
  signupSource: 'self',
};

const cookieState = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => Array.from(cookieState.entries()).map(([name, value]) => ({ name, value })),
    get: (name: string) =>
      cookieState.has(name) ? { value: cookieState.get(name)! } : undefined,
    set: (opts: { name: string; value: string }) => {
      cookieState.set(opts.name, opts.value);
    },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`__redirect:${url}`);
  },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'account.keys': {
        heading: 'Your API keys',
        requestButton: 'Request a new key',
        empty: 'No API keys yet. Request one →',
        filterAria: 'Filter by status',
        dash: '—',
        never: 'never',
        'columns.name': 'Name',
        'columns.prefix': 'Prefix',
        'columns.status': 'Status',
        'columns.created': 'Created',
        'columns.approved': 'Approved',
        'columns.lastUsed': 'Last used',
        'columns.error': 'Error',
        'status.all': 'all',
        'status.pending': 'pending',
        'status.active': 'active',
        'status.revoked': 'revoked',
      },
      'admin.common.pagination': {
        showing: 'Showing {start}–{end} of {total}',
      },
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

vi.mock('@/lib/auth/session', () => ({
  validateSession: async () => MOCKED_SESSION_USER,
  SESSION_COOKIE_NAME: 'ghc_admin_sid',
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  logout: vi.fn(),
  invalidateAllSessionsForUser: vi.fn(),
}));

beforeAll(async () => {
  operator = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      role: 'operator',
      status: 'active',
      passwordHash: await hashPassword(TEST_PASSWORD),
      signupSource: 'self',
    },
  });
  MOCKED_SESSION_USER.id = operator.id;

  sessionId = generateSessionId();
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: operator.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await prisma.apiKey.createMany({
    data: [
      {
        userId: operator.id,
        name: 'pending-key',
        keyPrefix: 'ghc_usr_pen',
        keyHash: `pending-${Date.now()}-1`,
        status: 'pending',
      },
      {
        userId: operator.id,
        name: 'active-key',
        keyPrefix: 'ghc_usr_act',
        keyHash: `active-${Date.now()}-2`,
        status: 'active',
        approvedAt: new Date(),
      },
      {
        userId: operator.id,
        name: 'revoked-key',
        keyPrefix: 'ghc_usr_rev',
        keyHash: `revoked-${Date.now()}-3`,
        status: 'revoked',
        revokedAt: new Date(),
      },
    ],
  });

  cookieState.set('ghc_admin_sid', sessionId);
});

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { userId: operator.id } });
  await prisma.session.deleteMany({ where: { userId: operator.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.$disconnect();
});

describe('/account/keys page', () => {
  it('renders all three of the user-owned keys', async () => {
    const { default: Page } = await import('@/app/account/keys/page');
    const tree = await Page({ searchParams: {} });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('active-key');
    expect(html).toContain('revoked-key');
    expect(html).toContain('pending-key');
  });

  it('filters by ?status=active (excludes pending + revoked)', async () => {
    const { default: Page } = await import('@/app/account/keys/page');
    const tree = await Page({ searchParams: { status: 'active' } });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('active-key');
    expect(html).not.toContain('revoked-key');
    expect(html).not.toContain('pending-key');
  });

  it('shows the request-a-key button', async () => {
    const { default: Page } = await import('@/app/account/keys/page');
    const tree = await Page({ searchParams: {} });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('/account/keys/request');
  });
});
