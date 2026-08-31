import { NextResponse } from 'next/server';

/**
 * M15 — machine-readable error codes for every 4xx/5xx response.
 *
 * Wire shape (additive — existing `error` field is preserved):
 *   { error: string, code: ErrorCode, requestId: string, details?: unknown }
 *
 * Clients that only read `error` keep working. New clients should branch
 * on `code` for retry / fallback decisions (e.g. retry on `rate_limited`
 * using `Retry-After`, do NOT retry on `not_found`).
 */
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'internal_error',
  'unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Map from ErrorCode to the HTTP status it implies. Single source of
 *  truth so the OpenAPI spec generator and the test suite both pull from
 *  here. */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503,
};

/** Reverse lookup for tests + diagnostics. */
export function statusToErrorCode(status: number): ErrorCode | null {
  for (const code of ERROR_CODES) {
    if (ERROR_CODE_STATUS[code] === status) return code;
  }
  return null;
}

interface ApiErrorOptions {
  /** Structured context — used by clients that want more than a string.
   *  Pass zod errors here as `{ fieldErrors: {...} }`. */
  details?: unknown;
  /** Extra response headers (e.g. `Retry-After` for 429). */
  headers?: Record<string, string>;
  /** Override requestId when the caller already has one (e.g. the
   *  middleware has stamped the response header). Defaults to reading
   *  the inbound `x-request-id` header so the field roundtrips. */
  requestId?: string;
}

/**
 * Build a `NextResponse` carrying the unified error envelope.
 *
 * Always returns a JSON response with:
 *   - `error`     human-readable string (kept for backward compat)
 *   - `code`      one of ERROR_CODES
 *   - `requestId` echoed from inbound `x-request-id` or a fresh UUID
 *   - `details`   optional structured context
 *
 * Caller can attach extra headers (e.g. rate-limit hints) via opts.
 */
export function apiError(
  code: ErrorCode,
  message: string,
  opts: ApiErrorOptions = {},
  req?: Request,
): NextResponse {
  const status = ERROR_CODE_STATUS[code];
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const requestId =
    opts.requestId ??
    (req ? sanitizeRequestId(req.headers.get('x-request-id')) : null) ??
    generateRequestId();
  headers['x-request-id'] = requestId;

  const body: Record<string, unknown> = {
    error: message,
    code,
    requestId,
  };
  if (opts.details !== undefined) body.details = opts.details;

  return NextResponse.json(body, { status, headers });
}

/** Build just the body object — useful when the caller already has a
 *  Response (e.g. wraps a `NextResponse.next()` from middleware). */
export function apiErrorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): Record<string, unknown> {
  const body: Record<string, unknown> = { error: message, code, requestId };
  if (details !== undefined) body.details = details;
  return body;
}

/* ---- request-id helpers (also used by middleware — see ./request-id.ts) ---- */

/** Validate an inbound `x-request-id`. Returns the value if safe (≤128
 *  chars, no control chars), else null. Keeping this strict prevents
 *  header-injection / log-poisoning through the request-id echo. */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length === 0 || raw.length > 128) return null;
  // Disallow CR / LF / NUL and any other control chars (0x00–0x1F, 0x7F).
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  return raw;
}

/** Edge-runtime safe UUID generator. Uses Web Crypto. */
export function generateRequestId(): string {
  // crypto.randomUUID is available on Edge runtime + Node 19+.
  return crypto.randomUUID();
}