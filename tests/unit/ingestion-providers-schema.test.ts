import { describe, it, expect } from 'vitest';
import {
  ProviderConfigSchema,
  parseProviderConfig,
  isProviderConfig,
} from '@/lib/ingestion/providers/schema';

describe('ProviderConfigSchema — file kind', () => {
  it('accepts a valid file config', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      path: '/tmp/list.json',
      itemsPath: '$.custom_nodes',
      urlField: 'files[0]',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kind).toBe('file');
    }
  });

  it('rejects file config without path', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      itemsPath: '$.nodes',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects file config with empty path', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      path: '',
      itemsPath: '$.nodes',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });
});

describe('ProviderConfigSchema — http kind', () => {
  it('accepts a valid http config', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$.data',
      urlField: 'html_url',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe('http');
  });

  it('accepts optional headers', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'http',
      url: 'https://example.com/list.json',
      itemsPath: '$.data',
      urlField: 'url',
      headers: { 'X-Auth': 'token123', Accept: 'application/json' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects http config with non-URL url', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'http',
      url: 'not-a-url',
      itemsPath: '$.data',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });
});

describe('ProviderConfigSchema — common rejections', () => {
  it('rejects missing kind', () => {
    const r = ProviderConfigSchema.safeParse({
      path: '/tmp/x.json',
      itemsPath: '$',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown kind', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'csv',
      path: '/tmp/x.csv',
      itemsPath: '$',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects path longer than 1024 chars', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      path: 'a'.repeat(1025),
      itemsPath: '$',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing itemsPath', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      path: '/tmp/x.json',
      urlField: 'url',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing urlField', () => {
    const r = ProviderConfigSchema.safeParse({
      kind: 'file',
      path: '/tmp/x.json',
      itemsPath: '$',
    });
    expect(r.success).toBe(false);
  });
});

describe('parseProviderConfig', () => {
  it('returns parsed config on success', () => {
    const out = parseProviderConfig({
      kind: 'file',
      path: '/tmp/x.json',
      itemsPath: '$.nodes',
      urlField: 'url',
    });
    expect(out.kind).toBe('file');
  });

  it('throws on invalid input', () => {
    expect(() =>
      parseProviderConfig({ kind: 'file', path: '/tmp/x.json' }),
    ).toThrow();
  });
});

describe('isProviderConfig', () => {
  it('returns true for valid config', () => {
    expect(
      isProviderConfig({
        kind: 'file',
        path: '/tmp/x.json',
        itemsPath: '$',
        urlField: 'url',
      }),
    ).toBe(true);
  });

  it('returns false for invalid config', () => {
    expect(isProviderConfig({ kind: 'unknown' })).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(isProviderConfig(null)).toBe(false);
    expect(isProviderConfig('string')).toBe(false);
    expect(isProviderConfig(42)).toBe(false);
  });
});