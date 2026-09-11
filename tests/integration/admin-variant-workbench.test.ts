import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('workbench variant CSS', () => {
  const css = readFileSync(resolve('src/app/globals.css'), 'utf8');

  it('has a [data-admin="workbench"] block with non-empty rules', () => {
    const match = css.match(/\[data-admin="workbench"\][^}]+}/);
    expect(match).not.toBeNull();
    expect(match![0].length).toBeGreaterThan(200);
  });

  it('assembly manual: KPI numbers at least 32px in workbench block', () => {
    expect(css).toMatch(/\[data-admin="workbench"\][\s\S]{0,2000}font-size:\s*(3[2-9]|[4-9]\d)px/);
  });

  it('assembly manual: table row min-height 56px', () => {
    expect(css).toMatch(/\[data-admin="workbench"\][\s\S]{0,3000}min-height:\s*56px/);
  });
});
