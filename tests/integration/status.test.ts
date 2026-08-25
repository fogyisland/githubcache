import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/v1/status/route';

describe('GET /api/v1/status', () => {
  it('returns ok with db up and empty token pool', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(body.tokens.active).toBe(0);
    expect(body.tokens.exhausted).toBe(0);
  });
});