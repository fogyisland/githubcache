import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/config/env', () => ({
  env: {
    NODE_ENV: 'development' as const,
    ADMIN_DEV_TOKEN: 'dev-only-token',
  },
}));

import { validateDevToken } from '@/lib/dev-token';

function makeReq(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set('x-admin-dev-token', token);
  return new Request('http://x/api/admin/whatever', { headers });
}

describe('validateDevToken (development mode)', () => {
  it('accepts matching token', () => {
    expect(validateDevToken(makeReq('dev-only-token'))).toBe(true);
  });

  it('rejects wrong token', () => {
    expect(validateDevToken(makeReq('wrong'))).toBe(false);
  });

  it('rejects missing header', () => {
    expect(validateDevToken(makeReq(null))).toBe(false);
  });
});

// Production-mode test requires re-importing with mocked NODE_ENV
describe('validateDevToken (production mode)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/config/env', () => ({
      env: {
        NODE_ENV: 'production' as const,
        ADMIN_DEV_TOKEN: 'dev-only-token',
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/config/env');
    vi.resetModules();
  });

  it('refuses in production even with valid token', async () => {
    const { validateDevToken: prodValidator } = await import('@/lib/dev-token');
    expect(prodValidator(makeReq('dev-only-token'))).toBe(false);
    expect(prodValidator(makeReq('wrong'))).toBe(false);
    expect(prodValidator(makeReq(null))).toBe(false);
  });
});
