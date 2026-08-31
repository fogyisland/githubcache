/**
 * Minimal JSONPath evaluator for M19 ingestion providers.
 *
 * Recognized forms:
 *   $                       — the root value itself
 *   $.a.b.c                 — property access
 *   $.a[0]                  — index access on the previous segment
 *   $.a[*].b                — wildcard over an array, then property on each
 *   $.a[*][*]               — wildcard then flatten (e.g. matrix)
 *   $.a[*][N]               — wildcard then index on each
 *
 * Does NOT support: $..desc, filter expressions [?(...)], script
 * expressions, multi-index [0,1], or slice [0:3]. These all throw
 * JsonPathError at the call site.
 *
 * Returning `undefined` for a missing property is supported and
 * considered a successful navigation (matches JavaScript semantics).
 * Only structural / type mismatches throw.
 */

export class JsonPathError extends Error {
  public readonly path: string;
  constructor(path: string, message: string) {
    super(`Invalid JSONPath "${path}": ${message}`);
    this.name = 'JsonPathError';
    this.path = path;
  }
}

const PROPERTY_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const INDEX_RE = /^\d+$/;

export function evaluateJsonPath(input: unknown, path: string): unknown {
  if (typeof path !== 'string' || !path.startsWith('$')) {
    throw new JsonPathError(path, 'must start with "$"');
  }
  let cur: unknown = input;
  let pendingWildcard = false;
  let i = 1; // skip the leading '$'
  const len = path.length;

  while (i < len) {
    // If the previous token was a wildcard '[*]', this iteration must
    // resolve the deferred per-element transformation.
    if (pendingWildcard) {
      if (!Array.isArray(cur)) {
        throw new JsonPathError(path, 'cannot [*] over non-array');
      }
      const ch = path[i]!;
      if (ch === '.') {
        PROPERTY_RE.lastIndex = i + 1;
        const m = PROPERTY_RE.exec(path);
        if (!m) {
          throw new JsonPathError(path, 'expected property name after ".*"');
        }
        cur = cur.map((el) =>
          el !== null && el !== undefined && typeof el === 'object'
            ? (el as Record<string, unknown>)[m[0]]
            : undefined,
        );
        i += 1 + m[0].length;
      } else if (ch === '[') {
        const close = path.indexOf(']', i);
        if (close === -1) {
          throw new JsonPathError(path, 'unmatched "["');
        }
        const inside = path.slice(i + 1, close);
        if (inside === '*') {
          cur = cur.flat();
          i = close + 1;
        } else if (INDEX_RE.test(inside)) {
          const idx = Number(inside);
          cur = cur.map((el) => (Array.isArray(el) ? el[idx] : undefined));
          i = close + 1;
        } else {
          throw new JsonPathError(
            path,
            `unsupported index expression "[${inside}]"`,
          );
        }
      } else {
        // End of path after '[*]': return the array as-is.
        return cur;
      }
      pendingWildcard = false;
      continue;
    }

    const ch = path[i]!;
    if (ch === '.') {
      PROPERTY_RE.lastIndex = i + 1;
      const m = PROPERTY_RE.exec(path);
      if (!m) {
        throw new JsonPathError(path, 'expected property name after "."');
      }
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        throw new JsonPathError(
          path,
          `cannot read property "${m[0]}" on ${
            cur === null ? 'null' : cur === undefined ? 'undefined' : typeof cur
          }`,
        );
      }
      cur = (cur as Record<string, unknown>)[m[0]];
      i += 1 + m[0].length;
    } else if (ch === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) {
        throw new JsonPathError(path, 'unmatched "["');
      }
      const inside = path.slice(i + 1, close);
      if (inside === '*') {
        if (!Array.isArray(cur)) {
          throw new JsonPathError(path, 'cannot [*] over non-array');
        }
        pendingWildcard = true;
        i = close + 1;
      } else if (INDEX_RE.test(inside)) {
        if (!Array.isArray(cur)) {
          throw new JsonPathError(path, `cannot [${inside}] over non-array`);
        }
        cur = cur[Number(inside)];
        i = close + 1;
      } else {
        throw new JsonPathError(path, `unsupported index expression "[${inside}]"`);
      }
    } else {
      throw new JsonPathError(path, `unexpected character "${ch}"`);
    }
  }
  return cur;
}