import { describe, it, expect } from 'vitest';
import { ENDPOINT_DOCS, findEndpointBySlug } from '@/lib/api-docs/registry';

describe('api-docs registry', () => {
  it('has one entry per public endpoint', () => {
    const slugs = ENDPOINT_DOCS.map((d) => d.slug);
    expect(slugs).toEqual(['api/v1-status', 'api/v1-repos', 'api/query']);
  });
  it('findEndpointBySlug returns the matching entry', () => {
    const doc = findEndpointBySlug('api/v1-repos');
    expect(doc?.path).toBe('/api/v1/repos/{owner}/{name}');
  });
  it('every entry has a non-empty summary', () => {
    for (const d of ENDPOINT_DOCS) {
      expect(d.summary.length).toBeGreaterThan(5);
    }
  });
  it('every entry has a response schema', () => {
    for (const d of ENDPOINT_DOCS) {
      expect(d.response).toBeDefined();
    }
  });
});
