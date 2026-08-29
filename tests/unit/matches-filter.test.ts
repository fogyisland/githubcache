import { describe, it, expect } from 'vitest';
import { matchesFilter } from '@/lib/webhooks/db';

describe('matchesFilter (webhook subscription predicate)', () => {
  it('wildcard ["*"] matches every action', () => {
    expect(matchesFilter(['*'], 'repo.refresh.succeeded')).toBe(true);
    expect(matchesFilter(['*'], 'anything.at.all')).toBe(true);
  });

  it('explicit action list matches listed actions only', () => {
    expect(
      matchesFilter(['repo.refresh.succeeded', 'repo.refresh.failed'], 'repo.refresh.succeeded'),
    ).toBe(true);
    expect(
      matchesFilter(['repo.refresh.succeeded'], 'repo.refresh.failed'),
    ).toBe(false);
  });

  it('fail-closed: empty array matches nothing', () => {
    expect(matchesFilter([], 'repo.refresh.succeeded')).toBe(false);
  });

  it('fail-closed: non-array eventFilter matches nothing', () => {
    expect(matchesFilter(null, 'x')).toBe(false);
    expect(matchesFilter(undefined, 'x')).toBe(false);
    expect(matchesFilter('repo.refresh.succeeded', 'repo.refresh.succeeded')).toBe(false);
    expect(matchesFilter({ action: '*' }, 'repo.refresh.succeeded')).toBe(false);
  });

  it('fail-closed: arrays containing non-strings match nothing', () => {
    expect(matchesFilter(['repo.refresh.succeeded', 42], 'repo.refresh.succeeded')).toBe(false);
    expect(matchesFilter([null], 'repo.refresh.succeeded')).toBe(false);
  });

  it('wildcard wins even alongside other entries', () => {
    expect(matchesFilter(['repo.refresh.succeeded', '*'], 'anything')).toBe(true);
  });
});