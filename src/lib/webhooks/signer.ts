import { createHmac, randomBytes } from 'crypto';

/**
 * Generate a fresh 32-byte (256-bit) signing secret for a new webhook
 * subscription. Returned as 64 lowercase-hex chars. Caller stores the
 * raw secret in the DB row (needed at delivery time to HMAC-sign each
 * payload) and surfaces it to the admin exactly once.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Compute the `X-Hub-Signature-256` header value for a webhook payload.
 * Format: `sha256={lowercase-hex-hmac}` — matches GitHub's webhook
 * signing convention so consumers can reuse existing verification code.
 *
 * Uses HMAC-SHA256 via node:crypto's createHmac. Receiver verifies with
 * the same shared secret.
 */
export function signWebhookPayload(secret: string, body: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

/** Constant-time string compare. Required so an attacker can't measure
 *  response time to learn the leading bytes of a valid signature. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}