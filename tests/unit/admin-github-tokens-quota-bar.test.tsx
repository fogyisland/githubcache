import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuotaBar } from '@/app/admin/github-tokens/_components/quota-bar';

describe('QuotaBar', () => {
  it('returns null when tokens list is empty', () => {
    const html = renderToStaticMarkup(<QuotaBar tokens={[]} />);
    expect(html).toBe('');
  });

  it('renders an SVG with one segment per token', () => {
    const html = renderToStaticMarkup(
      <QuotaBar
        tokens={[
          { id: '1', label: 'a', requestsUsed: 100, requestsLimit: 1000 },
          { id: '2', label: 'b', requestsUsed: 500, requestsLimit: 1000 },
        ]}
      />,
    );
    expect(html).toMatch(/<svg/);
    expect(html).toContain('viewBox="0 0 100 24"');
    // Each token becomes one filled rect (the used portion) + one outline rect (cap).
    expect((html.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('uses warn color for tokens >= 50% and danger for >= 80%', () => {
    const html = renderToStaticMarkup(
      <QuotaBar
        tokens={[
          { id: 'a', label: 'a', requestsUsed: 100, requestsLimit: 1000 }, // 10%
          { id: 'b', label: 'b', requestsUsed: 600, requestsLimit: 1000 }, // 60% warn
          { id: 'c', label: 'c', requestsUsed: 900, requestsLimit: 1000 }, // 90% danger
        ]}
      />,
    );
    // expect classes: ghc-quota-bar-fill, ghc-quota-bar-fill-warn, ghc-quota-bar-fill-danger
    expect(html).toContain('ghc-quota-bar-fill');
    expect(html).toContain('ghc-quota-bar-fill-warn');
    expect(html).toContain('ghc-quota-bar-fill-danger');
  });

  it('handles zero limit safely (does not divide by zero)', () => {
    const html = renderToStaticMarkup(
      <QuotaBar
        tokens={[
          { id: 'x', label: 'x', requestsUsed: 0, requestsLimit: 0 },
        ]}
      />,
    );
    expect(html).toMatch(/<svg/);
    // Just verify no NaN leaks into the markup
    expect(html).not.toContain('NaN');
  });

  it('renders a legend below the bar with #id label and pct', () => {
    const html = renderToStaticMarkup(
      <QuotaBar
        tokens={[
          { id: '42', label: 'ci-runner', requestsUsed: 250, requestsLimit: 500 },
        ]}
      />,
    );
    expect(html).toContain('#42');
    expect(html).toContain('ci-runner');
    expect(html).toContain('50%');
    expect(html).toContain('250');
    expect(html).toContain('500');
  });
});