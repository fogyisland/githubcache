import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  ERROR_CODE_STATUS,
  apiError,
  apiErrorBody,
  sanitizeRequestId,
  generateRequestId,
  statusToErrorCode,
  type ErrorCode,
} from '@/lib/api/errors';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('apiError helper (M15)', () => {
  it('preserves the legacy error field for backward compat', async () => {
    const res = apiError('not_found', 'repo not in cache');
    const body = await res.json();
    expect(body.error).toBe('repo not in cache');
  });

  it('includes the new code and requestId fields next to error', async () => {
    const res = apiError('rate_limited', 'too many requests');
    const body = await res.json();
    expect(body.code).toBe('rate_limited');
    expect(body.requestId).toMatch(UUID_V4);
  });

  it('maps every ErrorCode to its documented HTTP status', () => {
    for (const code of ERROR_CODES) {
      const res = apiError(code, 'msg');
      expect(res.status).toBe(ERROR_CODE_STATUS[code]);
    }
  });

  it('echoes the inbound x-request-id header when valid', async () => {
    const req = new Request('http://x/api', {
      headers: { 'x-request-id': 'client-correlation-123' },
    });
    const res = apiError('bad_request', 'invalid body', {}, req);
    expect(res.headers.get('x-request-id')).toBe('client-correlation-123');
    const body = await res.json();
    expect(body.requestId).toBe('client-correlation-123');
  });

  it('generates a fresh request-id when inbound header is invalid', async () => {
    // The WHATWG Headers constructor rejects control chars, so we mock
    // the headers API to simulate a poisoned inbound request.
    const req = {
      headers: { get: (_name: string) => 'bad\r\nvalue' },
    } as unknown as Request;
    const res = apiError('bad_request', 'invalid body', {}, req);
    const id = res.headers.get('x-request-id')!;
    expect(id).toMatch(UUID_V4);
  });

  it('forwards caller-supplied headers (e.g. Retry-After on 429)', async () => {
    const res = apiError('rate_limited', 'slow down', {
      headers: { 'Retry-After': '60' },
    });
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.status).toBe(429);
  });

  it('attaches structured details when provided', async () => {
    const res = apiError('bad_request', 'invalid body', {
      details: { fieldErrors: { repo: 'required' } },
    });
    const body = await res.json();
    expect(body.details).toEqual({ fieldErrors: { repo: 'required' } });
  });

  it('omits the details key entirely when not provided', async () => {
    const res = apiError('not_found', 'missing');
    const body = await res.json();
    expect('details' in body).toBe(false);
  });

  it('lets opts.requestId override everything else', async () => {
    const req = new Request('http://x/api', {
      headers: { 'x-request-id': 'inbound' },
    });
    const res = apiError('internal_error', 'boom', { requestId: 'manual-id' }, req);
    expect(res.headers.get('x-request-id')).toBe('manual-id');
    const body = await res.json();
    expect(body.requestId).toBe('manual-id');
  });

  it('apiErrorBody returns the envelope without constructing a Response', () => {
    const body = apiErrorBody('forbidden', 'no access', 'rid-xyz', { reason: 'inactive' });
    expect(body).toEqual({
      error: 'no access',
      code: 'forbidden',
      requestId: 'rid-xyz',
      details: { reason: 'inactive' },
    });
  });
});

describe('sanitizeRequestId', () => {
  it('accepts alphanumerics, dashes, and underscores', () => {
    expect(sanitizeRequestId('abc-123_DEF')).toBe('abc-123_DEF');
  });

  it('rejects strings longer than 128 chars', () => {
    expect(sanitizeRequestId('a'.repeat(129))).toBeNull();
    expect(sanitizeRequestId('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('rejects strings containing CR, LF, NUL, or other control chars', () => {
    expect(sanitizeRequestId('bad\r')).toBeNull();
    expect(sanitizeRequestId('bad\n')).toBeNull();
    expect(sanitizeRequestId('bad\0')).toBeNull();
    expect(sanitizeRequestId('bad\t')).toBeNull();
    expect(sanitizeRequestId('bad\x7f')).toBeNull();
  });

  it('rejects null / undefined / empty string', () => {
    expect(sanitizeRequestId(null)).toBeNull();
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId('')).toBeNull();
  });
});

describe('generateRequestId', () => {
  it('returns a valid UUID v4', () => {
    const id = generateRequestId();
    expect(id).toMatch(UUID_V4);
  });

  it('returns a unique value per call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(generateRequestId());
    expect(ids.size).toBe(50);
  });
});

describe('statusToErrorCode', () => {
  it('reverse-maps every documented status to its code', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_CODE_STATUS[code];
      expect(statusToErrorCode(status)).toBe<ErrorCode>(code);
    }
  });

  it('returns null for status codes outside the canonical set', () => {
    expect(statusToErrorCode(200)).toBeNull();
    expect(statusToErrorCode(418)).toBeNull();
    expect(statusToErrorCode(502)).toBeNull();
  });
});
