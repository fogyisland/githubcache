import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => {
    const dict: Record<string, string> = {
      'columns.name': 'Name',
      'columns.type': 'Type',
      'columns.description': 'Description',
      'badges.optional': '(optional)',
      'badges.nullable': '(nullable)',
      'scalar.array': '(array)',
    };
    return (key: string) => dict[key] ?? key;
  }),
}));

import { SchemaViewer } from '@/app/docs/_components/schema-viewer';

describe('SchemaViewer', () => {
  it('renders a flat object as a table with required + optional rows', async () => {
    const schema = z.object({
      owner: z.string().describe('GitHub owner.'),
      stars: z.number().int().describe('Star count.'),
      homepage: z.string().nullable().optional().describe('Project homepage.'),
    });
    const html = renderToStaticMarkup(await SchemaViewer({ schema, depth: 0 }));
    expect(html).toContain('owner');
    expect(html).toContain('GitHub owner.');
    expect(html).toContain('stars');
    expect(html).toContain('homepage');
    expect(html).toContain('(optional)');
    expect(html).toContain('(nullable)');
    expect(html).toContain('ghc-doc-table-row-required');
  });

  it('renders a union as side-by-side branches', async () => {
    const schema = z.union([z.object({ kind: z.literal('a') }), z.object({ kind: z.literal('b') })]);
    const html = renderToStaticMarkup(await SchemaViewer({ schema, depth: 0 }));
    expect(html).toContain('kind:');
    expect(html).toContain('"a"');
    expect(html).toContain('"b"');
  });

  it('renders an array as (array) indicator with inner schema', async () => {
    const schema = z.array(z.string());
    const html = renderToStaticMarkup(await SchemaViewer({ schema, depth: 0 }));
    expect(html).toContain('(array)');
    expect(html).toContain('string');
  });

  it('extracts .describe() into the description column', async () => {
    const schema = z.object({ x: z.string().describe('My special field.') });
    const html = renderToStaticMarkup(await SchemaViewer({ schema, depth: 0 }));
    expect(html).toContain('My special field.');
  });
});
