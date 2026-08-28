import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/v1/repos/[owner]/[name]/route';
import { prisma } from '@/lib/db/client';
import { createTestRepo } from './helpers/repos';

describe('GET /api/v1/repos/[owner]/[name]', () => {
  beforeEach(async () => {
    // refresh_jobs has FK to repositories — delete them first.
    await prisma.refreshJob.deleteMany({});
    await prisma.repository.deleteMany({});
    await prisma.ipRateLimitBucket.deleteMany({});
  });

  it('returns 200 with repository shape for cached repo', async () => {
    const repo = await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = new Request('http://localhost/api/v1/repos/octocat/Hello-World', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    const res = await GET(req, { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fetch_status).toBe('ok');
    expect(body.repository.owner).toBe('octocat');
    expect(body.repository.name).toBe('Hello-World');
  });

  it('returns 404 for repo with fetch_status=not_found', async () => {
    await createTestRepo({ owner: 'ghost', name: 'nope', status: 'not_found' });
    const req = new Request('http://localhost/api/v1/repos/ghost/nope', {
      headers: { 'x-forwarded-for': '203.0.113.2' },
    });
    const res = await GET(req, { params: { owner: 'ghost', name: 'nope' } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.fetch_status).toBe('not_found');
  });

  it('returns 429 after per-IP rate limit exceeded', async () => {
    await createTestRepo({ owner: 'octocat', name: 'Hello-World', status: 'ok' });
    const req = () => new Request('http://localhost/api/v1/repos/octocat/Hello-World', {
      headers: { 'x-forwarded-for': '203.0.113.3' },
    });
    // Need a helper to set PUBLIC_LOOKUP_RATE_PER_MIN low; or just hit it 31 times.
    for (let i = 0; i < 30; i++) {
      await GET(req(), { params: { owner: 'octocat', name: 'Hello-World' } });
    }
    const res = await GET(req(), { params: { owner: 'octocat', name: 'Hello-World' } });
    expect(res.status).toBe(429);
  }, 30_000);
});
