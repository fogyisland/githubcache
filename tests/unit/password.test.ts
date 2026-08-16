import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('hashPassword + verifyPassword', () => {
  it('hashes a password and verifies it', async () => {
    const plain = 'correct-horse-battery-staple';
    const hash = await hashPassword(plain);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/); // bcrypt format: $2a$12$...
    expect(await verifyPassword(plain, hash)).toBe(true);
  }, 10_000);

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('original');
    expect(await verifyPassword('different', hash)).toBe(false);
  }, 10_000);

  it('produces different hashes for the same input (salted)', async () => {
    const plain = 'same-input';
    const hash1 = await hashPassword(plain);
    const hash2 = await hashPassword(plain);
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(plain, hash1)).toBe(true);
    expect(await verifyPassword(plain, hash2)).toBe(true);
  }, 10_000);

  it('returns false for malformed hash (does not throw)', async () => {
    expect(await verifyPassword('any', 'not-a-bcrypt-hash')).toBe(false);
    expect(await verifyPassword('any', '')).toBe(false);
  }, 10_000);

  it('handles empty password (still hashes)', async () => {
    const hash = await hashPassword('');
    expect(await verifyPassword('', hash)).toBe(true);
    expect(await verifyPassword('not-empty', hash)).toBe(false);
  }, 10_000);

  it('handles unicode passwords', async () => {
    const plain = 'пароль密码🔒';
    const hash = await hashPassword(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword('пароль', hash)).toBe(false);
  }, 10_000);
});
