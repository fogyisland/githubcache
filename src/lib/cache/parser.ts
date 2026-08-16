const URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

const MAX_NODES = 50;

export interface ParsedNode {
  owner: string;
  name: string;
  original: string;
}

export type ParseNodesResult =
  | { ok: true; nodes: ParsedNode[] }
  | { ok: false; error: string };

export function parseNodes(input: unknown): ParseNodesResult {
  if (input === null || typeof input !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const nodes = (input as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return { ok: false, error: 'nodes must be an array' };
  if (nodes.length === 0) return { ok: false, error: 'nodes must not be empty' };
  if (nodes.length > MAX_NODES) return { ok: false, error: `max ${MAX_NODES} nodes` };

  const out: ParsedNode[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') {
      const parsed = parseStringNode(n);
      if (!parsed) return { ok: false, error: `bad node: ${n}` };
      out.push(parsed);
    } else if (n !== null && typeof n === 'object') {
      const parsed = parseObjectNode(n);
      if (!parsed) return { ok: false, error: 'invalid node shape (need { owner, repo } or { owner, name })' };
      out.push(parsed);
    } else {
      return { ok: false, error: 'invalid node shape' };
    }
  }
  return { ok: true, nodes: out };
}

function parseStringNode(s: string): ParsedNode | null {
  if (s.length === 0) return null;
  if (s.includes('://')) {
    const m = URL_RE.exec(s);
    if (!m) return null;
    return { owner: m[1]!, name: m[2]!, original: s };
  }
  const [owner, name] = s.split('/');
  if (!owner || !name) return null;
  return { owner, name, original: s };
}

function parseObjectNode(o: object): ParsedNode | null {
  const obj = o as { owner?: unknown; repo?: unknown; name?: unknown };
  const owner = typeof obj.owner === 'string' ? obj.owner : null;
  if (!owner) return null;
  const nameRaw = typeof obj.repo === 'string' ? obj.repo : typeof obj.name === 'string' ? obj.name : null;
  if (!nameRaw) return null;
  return { owner, name: nameRaw, original: `${owner}/${nameRaw}` };
}
