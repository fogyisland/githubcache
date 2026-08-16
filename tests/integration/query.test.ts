import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST } from '@/app/api/query/route';
import { prisma } from '@/lib/db/client';

const server = setupServer(
  http.get('https://api.github.com/repos/:owner/:name', ({ params }) =>
    HttpResponse.json({
      name: params.name,
      stargazers_count: 100,
      default_branch: 'main',
    }),
  ),
);

const TEST_OWNERS = ['cache-owner', 'miss-owner', 'dedupe'];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(async () => {
  server.close();
  for (const owner of TEST_OWNERS) {
    await prisma.repository.deleteMany({ where: { owner } });
  }
  await prisma.$disconnect();
});
beforeEach(async () => {
  server.resetHandlers();
  for (const owner of TEST_OWNERS) {
    await prisma.repository.deleteMany({ where: { owner } });
  }
});

async function postQuery(nodes: unknown[]): Promise<Response> {
  return POST(
    new Request('http://x/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes }),
    }),
  );
}

describe('POST /api/query', () => {
  it('cache hit returns existing row without upstream call', async () => {
    await prisma.repository.create({
      data: {
        owner: 'cache-owner',
        name: 'r',
        node: 'cache-owner/r',
        metadata: { cached: true },
        fetchStatus: 'ok',
      },
    });
    const res = await postQuery(['cache-owner/r']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ found: boolean; metadata: unknown }>;
    };
    expect(body.results[0]!.found).toBe(true);
    expect(body.results[0]!.metadata).toEqual({ cached: true });
  });

  it('cache miss fetches via GitHub (MSW) and persists', async () => {
    const res = await postQuery(['miss-owner/new']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ found: boolean; metadata: { name?: string } | null }>;
    };
    expect(body.results[0]!.found).toBe(true);
    expect(body.results[0]!.metadata).toMatchObject({ name: 'new' });
    const persisted = await prisma.repository.findUnique({
      where: { owner_name: { owner: 'miss-owner', name: 'new' } },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.fetchStatus).toBe('ok');
  });

  it('rejects > 50 nodes with 400', async () => {
    const res = await postQuery(new Array(51).fill('a/b'));
    expect(res.status).toBe(400);
  });

  it('rejects malformed body with 400', async () => {
    const res = await POST(
      new Request('http://x/api/query', {
        method: 'POST',
        body: JSON.stringify({ nodes: 'not-an-array' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('concurrent first-miss requests for the same key dedupe to one upstream call', async () => {
    let count = 0;
    server.use(
      http.get('https://api.github.com/repos/dedupe/:name', () => {
        count++;
        return HttpResponse.json({ name: 'r', stargazers_count: 7, default_branch: 'main' });
      }),
    );
    const responses = await Promise.all([
      postQuery(['dedupe/r']),
      postQuery(['dedupe/r']),
      postQuery(['dedupe/r']),
    ]);
    for (const r of responses) expect(r.status).toBe(200);
    expect(count).toBe(1);
  });
});