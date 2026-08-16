import { describe, it, expect } from 'vitest';
import { parseNodes } from '@/lib/cache/parser';

describe('parseNodes', () => {
  it('accepts full GitHub URL', () => {
    const r = parseNodes({ nodes: ['https://github.com/facebook/react'] });
    expect(r).toEqual({
      ok: true,
      nodes: [{ owner: 'facebook', name: 'react', original: 'https://github.com/facebook/react' }],
    });
  });

  it('accepts shorthand owner/name', () => {
    expect(parseNodes({ nodes: ['vuejs/core'] })).toEqual({
      ok: true,
      nodes: [{ owner: 'vuejs', name: 'core', original: 'vuejs/core' }],
    });
  });

  it('accepts object with { owner, repo }', () => {
    expect(parseNodes({ nodes: [{ owner: 'x', repo: 'y' }] })).toEqual({
      ok: true,
      nodes: [{ owner: 'x', name: 'y', original: 'x/y' }],
    });
  });

  it('accepts object with { owner, name }', () => {
    expect(parseNodes({ nodes: [{ owner: 'x', name: 'y' }] })).toEqual({
      ok: true,
      nodes: [{ owner: 'x', name: 'y', original: 'x/y' }],
    });
  });

  it('rejects non-array nodes', () => {
    expect(parseNodes({ nodes: 'a' }).ok).toBe(false);
  });

  it('rejects empty array', () => {
    expect(parseNodes({ nodes: [] }).ok).toBe(false);
  });

  it('rejects > 50 nodes', () => {
    expect(parseNodes({ nodes: new Array(51).fill('a/b') }).ok).toBe(false);
  });

  it('rejects malformed URL', () => {
    const r = parseNodes({ nodes: ['https://gitlab.com/foo/bar'] });
    expect(r.ok).toBe(false);
  });

  it('rejects bad object shape', () => {
    expect(parseNodes({ nodes: [{ foo: 'bar' }] }).ok).toBe(false);
  });

  it('rejects non-object body', () => {
    expect(parseNodes('not an object').ok).toBe(false);
    expect(parseNodes(null).ok).toBe(false);
  });
});
