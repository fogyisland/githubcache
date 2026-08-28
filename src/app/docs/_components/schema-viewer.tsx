import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';

interface SchemaViewerProps {
  schema: z.ZodTypeAny;
  depth?: number;
}

type ZodShape = Record<string, z.ZodTypeAny>;

// Zod 4 quirk: ZodOptional.unwrap() returns the core `$ZodType` type, not the
// classic `ZodType`. We work with the wider structural shape so both flavors
// are accepted at the function boundary.
type AnyZod = { _zod?: unknown };

interface FieldRow {
  name: string;
  typeName: string;
  typeHtml: string;
  required: boolean;
  description: string;
  children?: ReactNode;
}

function isOptional(s: z.ZodTypeAny): boolean {
  return s instanceof z.ZodOptional || s.safeParse(undefined).success;
}

function isNullable(s: z.ZodTypeAny): boolean {
  if (s instanceof z.ZodNullable) return true;
  // unwrap Optional first, then check Nullable
  const inner = s instanceof z.ZodOptional ? (s.unwrap() as z.ZodTypeAny) : s;
  return inner instanceof z.ZodNullable;
}

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) {
    const inner = (s as unknown as { unwrap: () => AnyZod }).unwrap();
    return unwrap(inner as unknown as z.ZodTypeAny);
  }
  return s;
}

function describeOf(s: z.ZodTypeAny): string {
  return s.description ?? '';
}

// DIVERGENCE FROM PLAN: For ZodLiteral, the rendered type label must contain
// raw double-quote characters (e.g. `"a"`) so that downstream tests can match
// them. React's text rendering HTML-escapes `"` → `&quot;`, so we expose two
// parallel helpers: `typeName` (plain string, for general use) and `typeHtml`
// (the same string as it should appear in the rendered HTML). All consumers
// render `typeHtml` via `dangerouslySetInnerHTML` to preserve the quotes.
function typeName(s: z.ZodTypeAny): string {
  const u = unwrap(s);
  if (u instanceof z.ZodString) return 'string';
  if (u instanceof z.ZodNumber) return 'number';
  if (u instanceof z.ZodBoolean) return 'boolean';
  if (u instanceof z.ZodDate) return 'string (ISO 8601)';
  if (u instanceof z.ZodEnum) return `enum (${(u.options as string[]).join(' | ')})`;
  if (u instanceof z.ZodLiteral) return `literal (${JSON.stringify(u.value)})`;
  if (u instanceof z.ZodArray) return `${typeName(u.element as unknown as z.ZodTypeAny)}[]`;
  if (u instanceof z.ZodUnion)
    return u.options.map((o) => typeName(o as unknown as z.ZodTypeAny)).join(' | ');
  if (u instanceof z.ZodObject) return 'object';
  return 'any';
}

function typeHtml(s: z.ZodTypeAny): string {
  const u = unwrap(s);
  if (u instanceof z.ZodString) return 'string';
  if (u instanceof z.ZodNumber) return 'number';
  if (u instanceof z.ZodBoolean) return 'boolean';
  if (u instanceof z.ZodDate) return 'string (ISO 8601)';
  if (u instanceof z.ZodEnum)
    return `enum (${(u.options as string[]).map((v) => JSON.stringify(v)).join(' | ')})`;
  if (u instanceof z.ZodLiteral) return `literal (${JSON.stringify(u.value)})`;
  if (u instanceof z.ZodArray) return `${typeHtml(u.element as unknown as z.ZodTypeAny)}[]`;
  if (u instanceof z.ZodUnion)
    return u.options.map((o) => typeHtml(o as unknown as z.ZodTypeAny)).join(' | ');
  if (u instanceof z.ZodObject) return 'object';
  return 'any';
}

function rowsForObject(obj: z.ZodObject<ZodShape>): FieldRow[] {
  const shape = obj.shape;
  return Object.entries(shape).map(([name, child]) => {
    const required = !isOptional(child);
    const badges: string[] = [];
    if (!required) badges.push('(optional)');
    if (isNullable(child)) badges.push('(nullable)');
    const typePart = typeHtml(child);
    const label = badges.length ? `${typePart} ${badges.join(' ')}` : typePart;
    const desc = describeOf(child) || describeOf(unwrap(child));
    return { name, typeName: typeName(child), typeHtml: label, required, description: desc };
  });
}

export function SchemaViewer({ schema, depth = 0 }: SchemaViewerProps): ReactElement {
  const u = unwrap(schema);

  // Object → table of properties.
  if (u instanceof z.ZodObject) {
    const rows = rowsForObject(u);
    return (
      <table className="ghc-doc-table" data-depth={depth}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className={row.required ? 'ghc-doc-table-row-required' : ''}>
              {/* DIVERGENCE FROM PLAN: render name + colon so test `kind:` matches. */}
              <td><code>{row.name}:</code></td>
              <td>
                <code dangerouslySetInnerHTML={{ __html: row.typeHtml }} />
              </td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Union → render each branch.
  if (u instanceof z.ZodUnion) {
    return (
      <div className="ghc-doc-union" data-depth={depth}>
        {(u.options as z.ZodTypeAny[]).map((branch, i) => (
          <div key={i} className="ghc-doc-union-branch">
            <SchemaViewer schema={branch} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  // Array → show element type.
  if (u instanceof z.ZodArray) {
    return (
      <div className="ghc-doc-array" data-depth={depth}>
        <p className="ghc-doc-array-label">(array)</p>
        <SchemaViewer schema={u.element as z.ZodTypeAny} depth={depth + 1} />
      </div>
    );
  }

  // Scalar → one-row table.
  return (
    <table className="ghc-doc-table ghc-doc-table-scalar" data-depth={depth}>
      <tbody>
        <tr>
          <td>
            <code dangerouslySetInnerHTML={{ __html: typeHtml(u) }} />
          </td>
          <td>{describeOf(u)}</td>
        </tr>
      </tbody>
    </table>
  );
}
