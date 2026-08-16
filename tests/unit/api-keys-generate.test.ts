import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@/lib/api-keys/generate';
import { verifyApiKey } from '@/lib/api-keys/verify';

describe('generateApiKey', () => {
  it('generates ghc_live_<32hex>', () => {
    const k = generateApiKey();
    expect(k.plain).toMatch(/^ghc_live_[0-9a-f]{32}$/);
    expect(k.plain).toHaveLength(41); // 'ghc_live_' (9) + 32 hex
    expect(k.prefix).toBe(k.plain.slice(0, 12));
    expect(k.hash).toHaveLength(64); // SHA-256 hex
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies via SHA-256', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(k.plain, k.hash)).toBe(true);
    expect(await verifyApiKey(k.plain + 'x', k.hash)).toBe(false);
  });

  it('10000 keys are unique', () => {
    const set = new Set<string>();
    for (let i = 0; i < 10_000; i++) set.add(generateApiKey().plain);
    expect(set.size).toBe(10_000);
  });

  it('wrong hash length returns false', async () => {
    const k = generateApiKey();
    expect(await verifyApiKey(k.plain, 'short')).toBe(false);
    expect(await verifyApiKey(k.plain, 'a'.repeat(63))).toBe(false);
    expect(await verifyApiKey(k.plain, 'a'.repeat(65))).toBe(false);
  });
});