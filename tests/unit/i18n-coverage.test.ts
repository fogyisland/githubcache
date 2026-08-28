import { describe, expect, it } from 'vitest';
import zhMessages from '@/../messages/zh.json';
import enMessages from '@/../messages/en.json';

type Messages = Record<string, unknown>;

function flattenKeys(obj: Messages, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v as Messages, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('i18n key parity', () => {
  it('zh.json has every key en.json has', () => {
    const enKeys = new Set(flattenKeys(enMessages as Messages));
    const zhKeys = new Set(flattenKeys(zhMessages as Messages));
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(missingInZh).toEqual([]);
  });

  it('en.json has every key zh.json has', () => {
    const enKeys = new Set(flattenKeys(enMessages as Messages));
    const zhKeys = new Set(flattenKeys(zhMessages as Messages));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(missingInEn).toEqual([]);
  });

  it('both bundles are non-empty', () => {
    expect(Object.keys(zhMessages).length).toBeGreaterThan(0);
    expect(Object.keys(enMessages).length).toBeGreaterThan(0);
  });
});
