import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api-docs.json/route';

describe('GET /api-docs.json (M15)', () => {
  it('returns a valid JSON envelope with version + generatedAt', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('1.0');
    expect(typeof body.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
  });

  it('emits Cache-Control header suitable for a static spec', async () => {
    const res = await GET();
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=300');
    expect(cc).toContain('stale-while-revalidate=600');
  });

  it('exposes server-wide caching strategy at the top level', async () => {
    const body = await (await GET()).json();
    expect(body.caching).toMatchObject({
      refresh_strategy: 'scheduler + on-miss',
      stale_path_on_github_down: 'serve',
    });
    expect(typeof body.caching.scheduler_tick_ms).toBe('number');
    expect(typeof body.caching.nightly_sweep_ms).toBe('number');
    expect(typeof body.caching.default_freshness_window_seconds).toBe('number');
  });

  it('emits one entry per registered endpoint', async () => {
    const body = await (await GET()).json();
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(body.endpoints.length).toBeGreaterThanOrEqual(3);

    const slugs = body.endpoints.map((e: { path: string; method: string }) => `${e.method} ${e.path}`);
    expect(slugs).toContain('GET /api/v1/status');
    expect(slugs).toContain('GET /api/v1/repos/{owner}/{name}');
    expect(slugs).toContain('POST /api/query');
  });

  it('each endpoint carries the public contract fields (no zod schema leaking)', async () => {
    const body = await (await GET()).json();
    for (const endpoint of body.endpoints) {
      expect(endpoint).toHaveProperty('path');
      expect(endpoint).toHaveProperty('method');
      expect(endpoint).toHaveProperty('summary');
      expect(endpoint).toHaveProperty('auth');
      expect(endpoint).toHaveProperty('rateLimit');
      expect(endpoint).toHaveProperty('cache');
      expect(endpoint).toHaveProperty('request');
      expect(endpoint).toHaveProperty('response');
      expect(endpoint).toHaveProperty('headers');
      expect(endpoint).toHaveProperty('errors');
      // zod schemas are stripped — only samples remain under response.
      expect(endpoint.response).toHaveProperty('samples');
      expect(endpoint.response).not.toHaveProperty('schema');
      expect(endpoint.response).not.toHaveProperty('response');
    }
  });

  it('cache-first endpoints expose freshness_window_seconds + stale_path', async () => {
    const body = await (await GET()).json();
    const repos = body.endpoints.find(
      (e: { path: string }) => e.path === '/api/v1/repos/{owner}/{name}',
    );
    expect(repos.cache).toEqual({
      mode: 'cache-first',
      freshness_window_seconds: 86400,
      stale_path: 'serve',
    });
  });

  it('passthrough endpoints omit freshness_window_seconds', async () => {
    const body = await (await GET()).json();
    const status = body.endpoints.find((e: { path: string }) => e.path === '/api/v1/status');
    expect(status.cache).toEqual({ mode: 'passthrough' });
    expect(status.cache).not.toHaveProperty('freshness_window_seconds');
  });

  it('every error entry carries a machine-readable code', async () => {
    const body = await (await GET()).json();
    for (const endpoint of body.endpoints) {
      for (const err of endpoint.errors ?? []) {
        expect(typeof err.code).toBe('string');
        expect(err.code.length).toBeGreaterThan(0);
        expect(typeof err.status).toBe('number');
      }
    }
  });
});
