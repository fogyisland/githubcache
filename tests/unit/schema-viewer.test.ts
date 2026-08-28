import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { z } from 'zod';
import { SchemaViewer } from '@/app/docs/_components/schema-viewer';

describe('SchemaViewer', () => {
  it('renders a flat object as a table with required + optional rows', () => {
    const schema = z.object({
      owner: z.string().describe('GitHub owner.'),
      stars: z.number().int().describe('Star count.'),
      homepage: z.string().nullable().optional().describe('Project homepage.'),
    });
    const html = renderToStaticMarkup(createElement(SchemaViewer, { schema, depth: 0 }));
    expect(html).toContain('owner');
    expect(html).toContain('GitHub owner.');
    expect(html).toContain('stars');
    expect(html).toContain('homepage');
    expect(html).toContain('(optional)');
    expect(html).toContain('(nullable)');
    expect(html).toContain('ghc-doc-table-row-required');
  });

  it('renders a union as side-by-side branches', () => {
    const schema = z.union([z.object({ kind: z.literal('a') }), z.object({ kind: z.literal('b') })]);
    const html = renderToStaticMarkup(createElement(SchemaViewer, { schema, depth: 0 }));
    expect(html).toContain('kind:');
    expect(html).toContain('"a"');
    expect(html).toContain('"b"');
  });

  it('renders an array as (array) indicator with inner schema', () => {
    const schema = z.array(z.string());
    const html = renderToStaticMarkup(createElement(SchemaViewer, { schema, depth: 0 }));
    expect(html).toContain('(array)');
    expect(html).toContain('string');
  });

  it('extracts .describe() into the description column', () => {
    const schema = z.object({ x: z.string().describe('My special field.') });
    const html = renderToStaticMarkup(createElement(SchemaViewer, { schema, depth: 0 }));
    expect(html).toContain('My special field.');
  });
});
