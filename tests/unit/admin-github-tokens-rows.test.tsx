import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TokenRow } from '@/app/admin/github-tokens/_components/token-row';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/lib/csrf/client', () => ({
  fetchCsrfToken: async () => 'csrf-stub',
}));

vi.mock('@/app/admin/_components/admin-token-test-button', () => ({
  AdminTokenTestButton: ({ tokenId }: { tokenId: string }) => (
    <button data-testid="test-button-stub" data-token-id={tokenId}>[t]</button>
  ),
}));

vi.mock('@/app/admin/github-tokens/_components/token-actions', () => ({
  TokenActions: ({ tokenId, currentStatus }: { tokenId: string; currentStatus: string }) => (
    <span data-testid="token-actions-stub" data-token-id={tokenId} data-status={currentStatus} />
  ),
}));

const baseToken = {
  id: 1n,
  label: 'ci-token-1',
  tokenHash: 'hash1',
  tokenFirst4: 'ghp1',
  tokenLast4: 'wxyz',
  status: 'active' as const,
  requestsUsed: 1240,
  requestsLimit: 5000,
  resetAt: null,
  lastUsedAt: new Date('2026-08-15T10:30:00Z'),
  createdAt: new Date('2026-08-01T12:00:00Z'),
};

// TokenRow takes a `t` prop directly (server-renderable). For tests we
// stub it with a simple identity function that prefixes every key so we
// can see what was looked up.
const tStub = (key: string): string => `[${key}]`;

describe('TokenRow', () => {
  it('renders status dot, label, prefix, usage, last-used for an active token', () => {
    const html = renderToStaticMarkup(
      <TokenRow token={baseToken} userTz="UTC" t={tStub} />,
    );
    expect(html).toContain('●'); // active dot
    expect(html).toContain('ci-token-1');
    expect(html).toContain('ghp1');
    expect(html).toContain('wxyz');
    expect(html).toMatch(/1,?240\s*\/\s*5,?000/); // used/limit (locale-aware)
    expect(html).toContain('test-button-stub');
    expect(html).toContain('token-actions-stub');
  });

  it('renders hollow dot for disabled tokens', () => {
    const html = renderToStaticMarkup(
      <TokenRow token={{ ...baseToken, status: 'disabled' }} userTz="UTC" t={tStub} />,
    );
    expect(html).toContain('○'); // disabled dot
  });

  it('renders em-dash for lastUsedAt when null', () => {
    const html = renderToStaticMarkup(
      <TokenRow token={{ ...baseToken, lastUsedAt: null }} userTz="UTC" t={tStub} />,
    );
    expect(html).toContain('—'); // em-dash for never
  });
});
