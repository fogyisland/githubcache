import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchRepoCore } from '@/lib/github/client';

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', () =>
    HttpResponse.json(
      { name: 'react', stargazers_count: 200000, default_branch: 'main' },
      { headers: { etag: 'W/"abc"' } },
    ),
  ),
);

describe('fetchRepoCore', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());

  it('returns data and etag', async () => {
    const r = await fetchRepoCore('facebook', 'react');
    expect(r.data).toMatchObject({ name: 'react' });
    expect(r.etag).toBe('W/"abc"');
  });
});