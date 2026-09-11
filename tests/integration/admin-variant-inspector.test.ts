import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('inspector variant CSS', () => {
  const css = readFileSync(resolve('src/app/globals.css'), 'utf8');

  it('has a [data-admin="inspector"] block with non-empty rules', () => {
    const match = css.match(/\[data-admin="inspector"\][^}]+}/);
    expect(match).not.toBeNull();
    expect(match![0].length).toBeGreaterThan(200); // not just a comment
  });

  it('forensic paper trail: row-height 1.7 or larger', () => {
    expect(css).toMatch(/\[data-admin="inspector"\][\s\S]{0,2000}line-height:\s*1\.[7-9]/);
  });

  it('hairline only: no box-shadow declarations in inspector block', () => {
    const block = css.match(/\[data-admin="inspector"\][^@]*?\}/g);
    if (block) {
      const allRules = block.join('\n');
      expect(allRules).not.toMatch(/box-shadow:/);
    }
  });
});
