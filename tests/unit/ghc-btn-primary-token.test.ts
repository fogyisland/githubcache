import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the "ghc-btn-primary is invisible in light theme"
 * bug.
 *
 * Root cause: globals.css defines `--brand` only inside the
 * `[data-theme="professional-dark"]` and `[data-theme="terminal"]`
 * blocks. The default `:root` block (which light/"professional" theme
 * inherits from) never declared it, so `background: var(--brand)`
 * inside `.ghc-btn-primary` resolved to `unset` (= transparent), with
 * hardcoded `color: white` and `border: var(--brand)` also transparent.
 * The button had correct dimensions but blended into the white card.
 *
 * If this test ever fails, someone removed `--brand` from `:root`
 * again — restore it. The token MUST exist at `:root` so every theme
 * that does not override it (light/professional by default) has a
 * visible primary color.
 */
describe('ghc-btn-primary brand token', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/app/globals.css'),
    'utf8',
  );

  it('--brand is set on :root so the default light theme has a visible primary color', () => {
    // Extract the first :root { ... } block.
    const rootMatch = css.match(/^:root\s*\{([\s\S]*?)\n\}/m);
    expect(rootMatch).not.toBeNull();
    if (!rootMatch) return;
    const rootBody = rootMatch[1]!;
    expect(rootBody).toMatch(/--brand\s*:/);
    expect(rootBody).toMatch(/--brand-hover\s*:/);
    expect(rootBody).toMatch(/--brand-soft\s*:/);
  });

  it('the :root --brand value is a real hex color (not transparent)', () => {
    const rootMatch = css.match(/^:root\s*\{([\s\S]*?)\n\}/m);
    expect(rootMatch).not.toBeNull();
    if (!rootMatch) return;
    const brandLine = rootMatch[1]!.split('\n').find((l) => l.includes('--brand:'));
    expect(brandLine).toBeDefined();
    // Must not be `transparent` and must be a #RRGGBB or rgb()/oklch() value.
    expect(brandLine).not.toMatch(/transparent/);
    expect(brandLine).toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|oklch\(/);
  });
});