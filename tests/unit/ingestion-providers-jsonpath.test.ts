import { describe, it, expect } from 'vitest';
import { evaluateJsonPath, JsonPathError } from '@/lib/ingestion/providers/jsonpath';

describe('evaluateJsonPath — root', () => {
  it('returns root when path is "$"', () => {
    expect(evaluateJsonPath({ a: 1 }, '$')).toEqual({ a: 1 });
  });
  it('returns root array when path is "$"', () => {
    expect(evaluateJsonPath([1, 2, 3], '$')).toEqual([1, 2, 3]);
  });
});

describe('evaluateJsonPath — property access', () => {
  it('reads a top-level property', () => {
    expect(evaluateJsonPath({ custom_nodes: [1, 2] }, '$.custom_nodes')).toEqual([1, 2]);
  });

  it('reads a nested property', () => {
    expect(
      evaluateJsonPath({ a: { b: { c: 42 } } }, '$.a.b.c'),
    ).toBe(42);
  });

  it('returns undefined for a missing property', () => {
    expect(evaluateJsonPath({ a: 1 }, '$.missing')).toBeUndefined();
  });
});

describe('evaluateJsonPath — index access', () => {
  it('reads index 0 of an array', () => {
    expect(
      evaluateJsonPath({ custom_nodes: [{ id: 'x' }, { id: 'y' }] }, '$.custom_nodes[0]'),
    ).toEqual({ id: 'x' });
  });

  it('reads the last index', () => {
    expect(
      evaluateJsonPath({ list: ['a', 'b', 'c'] }, '$.list[2]'),
    ).toBe('c');
  });

  it('reads a deeply nested indexed property', () => {
    expect(
      evaluateJsonPath(
        { nodes: [{ files: ['https://github.com/a/b'] }] },
        '$.nodes[0].files[0]',
      ),
    ).toBe('https://github.com/a/b');
  });

  it('returns undefined for an out-of-range index', () => {
    expect(evaluateJsonPath({ a: [1, 2] }, '$.a[10]')).toBeUndefined();
  });
});

describe('evaluateJsonPath — wildcard', () => {
  it('returns an array when [*] has no following property', () => {
    expect(
      evaluateJsonPath({ list: [10, 20, 30] }, '$.list[*]'),
    ).toEqual([10, 20, 30]);
  });

  it('maps a property over the array with [*].x', () => {
    expect(
      evaluateJsonPath(
        { custom_nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        '$.custom_nodes[*].id',
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('flattens one level with [*][*]', () => {
    // $.a[*][*] — first * selects sub-arrays, second * flattens to items
    expect(
      evaluateJsonPath(
        { a: [[1, 2], [3, 4], [5]] },
        '$.a[*][*]',
      ),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('[*][N] indexes into each sub-array', () => {
    expect(
      evaluateJsonPath(
        { a: [[10, 20, 30], [40, 50]] },
        '$.a[*][0]',
      ),
    ).toEqual([10, 40]);
  });
});

describe('evaluateJsonPath — errors', () => {
  it('throws when path does not start with $', () => {
    expect(() => evaluateJsonPath({}, '.a')).toThrow(JsonPathError);
  });

  it('throws on a missing property name after "."', () => {
    expect(() => evaluateJsonPath({}, '$.')).toThrow(JsonPathError);
  });

  it('throws on unmatched "["', () => {
    expect(() => evaluateJsonPath({ a: [] }, '$.a[0')).toThrow(JsonPathError);
  });

  it('throws on non-numeric, non-wildcard index', () => {
    expect(() => evaluateJsonPath({ a: [] }, '$.a[foo]')).toThrow(JsonPathError);
  });

  it('throws on [*] over a non-array', () => {
    expect(() => evaluateJsonPath({ a: 'string' }, '$.a[*].x')).toThrow(JsonPathError);
  });

  it('throws on numeric index over a non-array', () => {
    expect(() => evaluateJsonPath({ a: 'string' }, '$.a[0]')).toThrow(JsonPathError);
  });

  it('throws on property access on null', () => {
    expect(() => evaluateJsonPath({ a: null }, '$.a.b')).toThrow(JsonPathError);
  });

  it('throws on unexpected character after "$"', () => {
    expect(() => evaluateJsonPath({}, '$!')).toThrow(JsonPathError);
  });
});