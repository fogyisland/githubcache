import { NextResponse, type NextRequest } from 'next/server';
import { generateRequestId, sanitizeRequestId } from './errors';

/**
 * Stamp the request-id on the response. Used by middleware (Edge runtime)
 * for every request, and by `apiError()` for 4xx/5xx JSON bodies.
 *
 * Inbound `x-request-id` (if any) is echoed back after sanitization.
 * Otherwise a fresh UUID v4 is generated via Web Crypto (Edge-safe).
 *
 * The middleware stamps this on the response BEFORE the route handler
 * runs, so the header is present even on cache hits and successful
 * responses — clients can always correlate a request to its log line.
 */
export function applyRequestId(req: NextRequest, res: NextResponse): NextResponse {
  const inbound = sanitizeRequestId(req.headers.get('x-request-id'));
  res.headers.set('x-request-id', inbound ?? generateRequestId());
  return res;
}

/** Read-only accessor for route handlers that want to log the id without
 *  mutating the response. */
export function readRequestId(req: Request | NextRequest): string {
  return sanitizeRequestId(req.headers.get('x-request-id')) ?? generateRequestId();
}