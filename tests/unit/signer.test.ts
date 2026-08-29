import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  generateWebhookSecret,
  signWebhookPayload,
  constantTimeEqual,
} from '@/lib/webhooks/signer';

describe('webhook signer', () => {
  describe('generateWebhookSecret', () => {
    it('returns a 64-char lowercase hex string', () => {
      const s = generateWebhookSecret();
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns a unique secret per call', () => {
      const a = generateWebhookSecret();
      const b = generateWebhookSecret();
      expect(a).not.toEqual(b);
    });
  });

  describe('signWebhookPayload', () => {
    it('produces sha256=<hex> matching an independent HMAC computation', () => {
      const secret = generateWebhookSecret();
      const body = JSON.stringify({ hello: 'world' });
      const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      expect(signWebhookPayload(secret, body)).toEqual(expected);
    });

    it('changes when the body changes (signature is payload-bound)', () => {
      const secret = generateWebhookSecret();
      const a = signWebhookPayload(secret, '{"a":1}');
      const b = signWebhookPayload(secret, '{"a":2}');
      expect(a).not.toEqual(b);
    });

    it('changes when the secret changes', () => {
      const body = '{"x":1}';
      const a = signWebhookPayload('a'.repeat(64), body);
      const b = signWebhookPayload('b'.repeat(64), body);
      expect(a).not.toEqual(b);
    });
  });

  describe('constantTimeEqual', () => {
    it('returns true for identical strings', () => {
      expect(constantTimeEqual('abc', 'abc')).toBe(true);
    });

    it('returns false for different strings of the same length', () => {
      expect(constantTimeEqual('abc', 'abd')).toBe(false);
    });

    it('returns false for different-length strings', () => {
      expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    });

    it('returns false for empty vs non-empty', () => {
      expect(constantTimeEqual('', 'a')).toBe(false);
      expect(constantTimeEqual('a', '')).toBe(false);
    });
  });
});