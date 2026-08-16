import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock env BEFORE importing the loader (module-load-time reads env.GITHUB_TOKENS*).
// Use vi.hoisted so the factory runs before vi.mock resolves it.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: { GITHUB_TOKENS: undefined as string | undefined, GITHUB_TOKENS_FILE: undefined as string | undefined } }));

vi.mock('@/lib/config/env', () => ({ env: mockEnv }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { loadTokensFromEnv } from '@/lib/github/tokens-loader';

let tmpDir: string;

beforeEach(() => {
  mockEnv.GITHUB_TOKENS = undefined;
  mockEnv.GITHUB_TOKENS_FILE = undefined;
  tmpDir = mkdtempSync(join(tmpdir(), 'tokens-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content);
  return p;
}

describe('loadTokensFromEnv', () => {
  it('returns [] when neither env nor file is set', () => {
    expect(loadTokensFromEnv()).toEqual([]);
  });

  it('parses a single token from GITHUB_TOKENS', () => {
    mockEnv.GITHUB_TOKENS = 'ghp_aaaabbbbccccddddeeeeffff00001111';
    const t = loadTokensFromEnv();
    expect(t).toHaveLength(1);
    expect(t[0]!.raw).toBe('ghp_aaaabbbbccccddddeeeeffff00001111');
    expect(t[0]!.first4).toBe('ghp_');
    expect(t[0]!.last4).toBe('1111');
    expect(t[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parses multiple comma-separated tokens', () => {
    mockEnv.GITHUB_TOKENS = 'ghp_aaa,ghp_bbb,ghp_ccc';
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_aaa', 'ghp_bbb', 'ghp_ccc']);
    expect(t).toHaveLength(3);
    expect(new Set(t.map((x) => x.hash)).size).toBe(3); // distinct hashes
  });

  it('trims whitespace and skips blanks', () => {
    mockEnv.GITHUB_TOKENS = '  ghp_aaa , , ghp_bbb  ';
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_aaa', 'ghp_bbb']);
  });

  it('dedupes identical tokens', () => {
    mockEnv.GITHUB_TOKENS = 'ghp_aaa,ghp_aaa,ghp_bbb';
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_aaa', 'ghp_bbb']);
  });

  it('reads one token per line from GITHUB_TOKENS_FILE', () => {
    mockEnv.GITHUB_TOKENS_FILE = writeFile('tokens.txt', 'ghp_aaa\nghp_bbb\n');
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_aaa', 'ghp_bbb']);
  });

  it('skips blank lines and # comments in file', () => {
    mockEnv.GITHUB_TOKENS_FILE = writeFile('tokens.txt', '# header\nghp_aaa\n\n# comment\nghp_bbb\n');
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_aaa', 'ghp_bbb']);
  });

  it('file takes precedence over env when both are set', () => {
    mockEnv.GITHUB_TOKENS = 'ghp_from_env';
    mockEnv.GITHUB_TOKENS_FILE = writeFile('tokens.txt', 'ghp_from_file\n');
    const t = loadTokensFromEnv();
    expect(t.map((x) => x.raw)).toEqual(['ghp_from_file']);
  });

  it('throws when GITHUB_TOKENS_FILE is set but file is missing', () => {
    mockEnv.GITHUB_TOKENS_FILE = join(tmpDir, 'does-not-exist.txt');
    expect(() => loadTokensFromEnv()).toThrow(/GITHUB_TOKENS_FILE/);
  });

  it('hash is stable across calls', () => {
    mockEnv.GITHUB_TOKENS = 'ghp_aaa';
    const t1 = loadTokensFromEnv();
    const t2 = loadTokensFromEnv();
    expect(t1[0]!.hash).toBe(t2[0]!.hash);
  });

  it('returns [] when GITHUB_TOKENS is empty string', () => {
    mockEnv.GITHUB_TOKENS = '';
    expect(loadTokensFromEnv()).toEqual([]);
  });

  it('returns [] when file has only comments', () => {
    mockEnv.GITHUB_TOKENS_FILE = writeFile('tokens.txt', '# only comments\n\n');
    expect(loadTokensFromEnv()).toEqual([]);
  });
});