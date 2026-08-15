import { describe, it, expect } from 'vitest';
import { parseRepoResponse } from '@/lib/github/fields';

describe('parseRepoResponse', () => {
  it('normalizes core fields', () => {
    const out = parseRepoResponse({
      name: 'react',
      stargazers_count: 1,
      default_branch: 'main',
      license: { spdx_id: 'MIT' },
      topics: ['ui'],
    });
    expect(out.name).toBe('react');
    expect(out.stars).toBe(1);
    expect(out.defaultBranch).toBe('main');
    expect(out.license).toBe('MIT');
    expect(out.topics).toEqual(['ui']);
  });

  it('handles missing license and topics', () => {
    const out = parseRepoResponse({ name: 'r', default_branch: 'main' });
    expect(out.license).toBeNull();
    expect(out.topics).toEqual([]);
  });
});