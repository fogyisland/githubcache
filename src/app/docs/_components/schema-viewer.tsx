import type { ReactElement, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
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

// Render `typeHtml` via dangerouslySetInnerHTML so the literal quotes around
// e.g. `"ok"` survive React's text-escaping pass. Input is always derived
// from registry-authored Zod schemas, never user input.
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

// Derive a human-readable branch label from a ZodUnion option. Looks for the
// first ZodLiteral in the discriminant field (e.g. fetch_status: 'ok') and
// returns its JSON-serialised value. Falls back to the position index when
// the option is not a literal-tagged object.
function branchLabel(branch: z.ZodTypeAny, index: number): string {
  const u = unwrap(branch);
  if (u instanceof z.ZodObject) {
    const shape = u.shape as ZodShape;
    // Prefer the first ZodLiteral field — typically the discriminant.
    for (const child of Object.values(shape)) {
      const inner = unwrap(child);
      if (inner instanceof z.ZodLiteral) return JSON.stringify(inner.value);
    }
  }
  return `option ${index + 1}`;
}

function rowsForObject(obj: z.ZodObject<ZodShape>, badges: { optional: string; nullable: string }): FieldRow[] {
  const shape = obj.shape;
  return Object.entries(shape).map(([name, child]) => {
    const required = !isOptional(child);
    const badgeList: string[] = [];
    if (!required) badgeList.push(badges.optional);
    if (isNullable(child)) badgeList.push(badges.nullable);
    const typePart = typeHtml(child);
    const label = badgeList.length ? `${typePart} ${badgeList.join(' ')}` : typePart;
    const desc = describeOf(child) || describeOf(unwrap(child));
    return { name, typeHtml: label, required, description: desc };
  });
}

export async function SchemaViewer({ schema, depth = 0 }: SchemaViewerProps): Promise<ReactElement> {
  const t = await getTranslations('docs.schema');
  const u = unwrap(schema);

  // Object → table of properties.
  if (u instanceof z.ZodObject) {
    const rows = rowsForObject(u, { optional: t('badges.optional'), nullable: t('badges.nullable') });
    return (
      <table className="ghc-doc-table" data-depth={depth}>
        <thead>
          <tr>
            <th>{t('columns.name')}</th>
            <th>{t('columns.type')}</th>
            <th>{t('columns.description')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className={row.required ? 'ghc-doc-table-row-required' : ''}>
              {/* Render name + colon so test `kind:` matches. */}
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

  // Union → render each branch side-by-side with a role label derived
  // from the discriminant literal (e.g. "ok", "not_found", "error").
  if (u instanceof z.ZodUnion) {
    const branches = await Promise.all(
      (u.options as z.ZodTypeAny[]).map(async (branch, i) => ({
        i,
        branch,
        rendered: await SchemaViewer({ schema: branch, depth: depth + 1 }),
      })),
    );
    return (
      <div className="ghc-doc-union" data-depth={depth}>
        {branches.map(({ i, branch, rendered }) => (
          <div key={i} className="ghc-doc-union-branch">
            <span className="ghc-doc-union-branch-label">{branchLabel(branch, i)}</span>
            {rendered}
          </div>
        ))}
      </div>
    );
  }

  // Array → show element type.
  if (u instanceof z.ZodArray) {
    const elementRendered = await SchemaViewer({
      schema: u.element as z.ZodTypeAny,
      depth: depth + 1,
    });
    return (
      <div className="ghc-doc-array" data-depth={depth}>
        <p className="ghc-doc-array-label">{t('scalar.array')}</p>
        {elementRendered}
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
