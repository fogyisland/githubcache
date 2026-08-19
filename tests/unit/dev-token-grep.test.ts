import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = 'src';

/**
 * Grep-verification that the M3 dev-token admin auth module is fully gone.
 *
 * The M3 dev-token endpoint (`/api/admin/dev-token-approve`) and helper
 * (`@/lib/dev-token`) were temporary placeholders for cookie-session auth in
 * M6. M6 deletes them outright — no compatibility shim. This test fails if
 * anyone re-introduces dev-token code by accident.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /validateDevToken/,
  /devTokenActor/,
  /ADMIN_DEV_TOKEN/,
  /dev-token/,
  /x-admin-dev-token/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('dev-token module fully removed', () => {
  it('no .ts/.tsx file references dev-token code', () => {
    const offenders: { file: string; pattern: string; line: string }[] = [];
    for (const file of walk(SRC_DIR)) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line) => {
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push({ file, pattern: pattern.source, line: line.trim() });
          }
        }
      });
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} dev-token reference(s):\n` +
          offenders.map((o) => `  ${o.file}:${o.pattern}: ${o.line}`).join('\n'),
      );
    }
    expect(offenders.length).toBe(0);
  });

  it('src/lib/dev-token/ directory does not exist', () => {
    expect(() => statSync('src/lib/dev-token')).toThrow();
  });

  it('src/app/api/admin/dev-token-approve/ directory does not exist', () => {
    expect(() => statSync('src/app/api/admin/dev-token-approve')).toThrow();
  });
});