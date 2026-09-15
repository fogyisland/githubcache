/**
 * M32.7.5 — release.ts must not strip legitimate src/.../test/ routes.
 *
 * Background: `release/` is built by `scripts/release.ts`, which excludes
 * any dir named `test` at any depth (`EXCLUDE_DIRS` + non-`ROOT_ONLY`).
 * This silently strips legitimate Next.js route folders like
 * `src/app/api/admin/github-tokens/[id]/test/` (the "test this token"
 * admin endpoint), returning 404 on the production build.
 *
 * Fix: `test` is now in `ROOT_ONLY_EXCLUDE_DIRS` (added in M32.7.5),
 * so it's only excluded at the repo root, not inside src/. This test
 * pins that contract by reading the source and asserting the constant.
 *
 * If you change `EXCLUDE_DIRS` or `ROOT_ONLY_EXCLUDE_DIRS`, this test
 * tells future-you whether the rule still applies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RELEASE_TS = resolve(__dirname, '../../scripts/release.ts');

function readReleaseSource(): string {
  return readFileSync(RELEASE_TS, 'utf8');
}

describe('release.ts path-aware excludes (M32.7.5)', () => {
  it('declares `test` in ROOT_ONLY_EXCLUDE_DIRS (not just EXCLUDE_DIRS)', () => {
    const src = readReleaseSource();

    // The `test` name must be present inside the ROOT_ONLY_EXCLUDE_DIRS
    // literal. We grep for the literal pattern that release.ts uses
    // (single-quoted array element with trailing comma) to avoid false
    // positives in comments.
    const rootOnlyMatch = src.match(
      /const ROOT_ONLY_EXCLUDE_DIRS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(rootOnlyMatch, 'ROOT_ONLY_EXCLUDE_DIRS literal not found').toBeTruthy();
    expect(rootOnlyMatch![1]).toMatch(/['"]test['"]/);

    // And it must NOT be marked as excluded at any depth (the comment
    // next to EXCLUDE_DIRS used to claim it was safe). We assert by
    // checking that `shouldExclude` short-circuits on ROOT_ONLY before
    // the global EXCLUDE_DIRS check.
    expect(src).toMatch(
      /EXCLUDE_DIRS\.has\(name\)\s*&&\s*ROOT_ONLY_EXCLUDE_DIRS\.has\(name\)\s*&&\s*parts\.length\s*===\s*0/,
    );
  });

  it('the gitignored scratch dir `test/` at repo root is still excluded (root-only)', () => {
    // Sanity: the original purpose — excluding the ad-hoc shell scripts
    // in `test/` at the repo root — is preserved. We don't run the
    // script here; we just verify the ROOT_ONLY_EXCLUDE_DIRS plumbing
    // is set up to honor the contract documented in the release.ts
    // comment block.
    const src = readReleaseSource();
    expect(src).toContain('root-level scratch');
    // And `test` should NOT appear in EXCLUDE_DIRS without also being
    // in ROOT_ONLY_EXCLUDE_DIRS. We assert presence in ROOT_ONLY
    // (covered above) and that `EXCLUDE_DIRS` itself still lists it
    // (so the root-level exclusion still fires).
    const excludeMatch = src.match(
      /const EXCLUDE_DIRS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(excludeMatch![1]).toMatch(/['"]test['"]/);
  });
});
