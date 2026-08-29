import { describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { applyRequestId, readRequestId } from '@/lib/api/request-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeNextReq(opts: { id?: string | null; url?: string } = {}) {
  // Mock the headers API directly so we can simulate control-char values
  // that the WHATWG Headers constructor would reject.
  const headers = {
    get: (name: string) => {
      if (opts.id === undefined || opts.id === null) return null;
      return name.toLowerCase() === 'x-request-id' ? opts.id : null;
    },
  };
  const req = {
    headers,
  } as unknown as Parameters<typeof applyRequestId>[0];
  return req;
}

describe('applyRequestId (M15)', () => {
  it('stamps a fresh UUID when inbound header is missing', () => {
    const res = NextResponse.next();
    const out = applyRequestId(makeNextReq(), res);
    expect(out.headers.get('x-request-id')).toMatch(UUID_V4);
  });

  it('echoes a valid inbound x-request-id', () => {
    const res = NextResponse.next();
    const out = applyRequestId(makeNextReq({ id: 'abc-123' }), res);
    expect(out.headers.get('x-request-id')).toBe('abc-123');
  });

  it('replaces an invalid inbound id (control chars) with a fresh UUID', () => {
    const res = NextResponse.next();
    const out = applyRequestId(makeNextReq({ id: 'bad\r\nvalue' }), res);
    expect(out.headers.get('x-request-id')).toMatch(UUID_V4);
  });

  it('returns the same response object so callers can chain', () => {
    const res = NextResponse.next();
    const out = applyRequestId(makeNextReq(), res);
    expect(out).toBe(res);
  });
});

describe('readRequestId', () => {
  it('returns the inbound id when valid', () => {
    const id = readRequestId(
      new Request('http://x', { headers: { 'x-request-id': 'correlate-99' } }),
    );
    expect(id).toBe('correlate-99');
  });

  it('falls back to a fresh UUID when inbound is invalid or missing', () => {
    expect(readRequestId(new Request('http://x'))).toMatch(UUID_V4);
    expect(
      readRequestId(new Request('http://x', { headers: { 'x-request-id': 'a'.repeat(200) } })),
    ).toMatch(UUID_V4);
  });
});

describe('caching stability', () => {
  it('repeated applyRequestId calls produce distinct UUIDs when no inbound header', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = NextResponse.next();
      const out = applyRequestId(makeNextReq(), res);
      ids.add(out.headers.get('x-request-id')!);
    }
    expect(ids.size).toBe(20);
  });
});

// Silence vi from the imported modules we don't need to spy on.
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: vi.fn() }));
