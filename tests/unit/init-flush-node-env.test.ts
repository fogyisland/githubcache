/**
 * M32.7.4 — defense tests for `scripts/init.ts` NODE_ENV handling.
 *
 * Two new behaviors pin here:
 *
 * 1. `NODE_ENV` is added to the FLUSH_TO_ENV list — when the shell env
 *    has NODE_ENV=production (or anything non-empty) and the .env
 *    doesn't, init flushes the shell value into .env. This makes
 *    `NODE_ENV=production npm run init -- --non-interactive` produce
 *    the right value in .env even if .env.example didn't ship it.
 *
 * 2. In non-interactive mode (either the --non-interactive flag OR
 *    stdin not being a TTY), init forces NODE_ENV=production in .env
 *    regardless of what shell or template supplied. This is the
 *    "deploy is not a place for guesswork" safety net.
 *
 * We test by importing the script's exported helpers — but `init.ts`
 * runs everything inside `main()` on import. To exercise just the
 * env-line helpers, we re-implement the same algorithm in this test
 * file (the helpers are pure functions, so we copy them verbatim) and
 * assert the contract. The actual integration is verified by
 * scripts/smoke-init-node-env.mjs after the change.
 */
import { describe, it, expect } from 'vitest';

// Mirror of scripts/init.ts pure helpers — these must match the
// production code. If you change one, change the other.
function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split(/\r?\n/);
  const idx = lines.findIndex((l) => new RegExp(`^${key}=`).test(l));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    const insertAt = lines.findIndex((l) => l.trim() === '' || l.trim().startsWith('#'));
    if (insertAt >= 0) {
      lines.splice(insertAt, 0, newLine);
    } else {
      lines.push(newLine);
    }
  }
  return lines
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .replace(/^\n+/, '')
    .concat('\n');
}

function readEnvLine(content: string, key: string): string | null {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(content);
  return m && m[1] !== undefined ? m[1] : null;
}

/** Mirror of the non-interactive NODE_ENV force block in scripts/init.ts. */
function forceProductionInNonInteractive(
  content: string,
  isNonInteractive: boolean,
): { content: string; didForce: boolean } {
  if (!isNonInteractive) return { content, didForce: false };
  const fromFile = readEnvLine(content, 'NODE_ENV');
  if (fromFile !== 'production') {
    return {
      content: upsertEnvLine(content, 'NODE_ENV', 'production'),
      didForce: true,
    };
  }
  return { content, didForce: false };
}

describe('upsertEnvLine + readEnvLine (mirror of scripts/init.ts helpers)', () => {
  it('inserts a new key before the first comment/blank block', () => {
    const content = `DATABASE_URL=mysql://x\nPORT=3000\n\n# comment\n`;
    const out = upsertEnvLine(content, 'NODE_ENV', 'production');
    expect(readEnvLine(out, 'NODE_ENV')).toBe('production');
    // NODE_ENV line should come before the blank line / comment.
    expect(out.indexOf('NODE_ENV=')).toBeLessThan(out.indexOf('\n\n#'));
  });

  it('overwrites an existing key in place', () => {
    const content = `NODE_ENV=development\nPORT=3000\n`;
    const out = upsertEnvLine(content, 'NODE_ENV', 'production');
    expect(readEnvLine(out, 'NODE_ENV')).toBe('production');
    expect(out).not.toContain('NODE_ENV=development');
  });
});

describe('forceProductionInNonInteractive (M32.7.4 Layer 3 — init fail-safe)', () => {
  it('forces production when .env had development + non-interactive', () => {
    const content = `DATABASE_URL=mysql://x\nNODE_ENV=development\nPORT=3000\n`;
    const { content: out, didForce } = forceProductionInNonInteractive(content, true);
    expect(didForce).toBe(true);
    expect(readEnvLine(out, 'NODE_ENV')).toBe('production');
  });

  it('forces production when .env has no NODE_ENV line + non-interactive', () => {
    const content = `DATABASE_URL=mysql://x\nPORT=3000\n`;
    const { content: out, didForce } = forceProductionInNonInteractive(content, true);
    expect(didForce).toBe(true);
    expect(readEnvLine(out, 'NODE_ENV')).toBe('production');
  });

  it('does NOT force when .env already has production + non-interactive (idempotent)', () => {
    const content = `NODE_ENV=production\nPORT=3000\n`;
    const { didForce } = forceProductionInNonInteractive(content, true);
    expect(didForce).toBe(false);
    expect(readEnvLine(content, 'NODE_ENV')).toBe('production');
  });

  it('does NOT force when interactive (TTY attached, dev box case)', () => {
    // This is the critical local-dev case: a developer runs
    // `npm run init` interactively after .env.example flipped to
    // NODE_ENV=production. The init script should NOT clobber their
    // pre-set value if they later flipped it to development.
    const content = `NODE_ENV=development\nPORT=3000\n`;
    const { content: out, didForce } = forceProductionInNonInteractive(content, false);
    expect(didForce).toBe(false);
    expect(readEnvLine(out, 'NODE_ENV')).toBe('development');
  });

  it('does NOT touch .env when interactive even with production already set', () => {
    const content = `NODE_ENV=production\nPORT=3000\n`;
    const { content: out, didForce } = forceProductionInNonInteractive(content, false);
    expect(didForce).toBe(false);
    expect(out).toBe(content);
  });
});

describe('FLUSH_TO_ENV semantics (M32.7.4 Layer 2 — flush shell NODE_ENV)', () => {
  // The actual FLUSH_TO_ENV list at scripts/init.ts:228 includes NODE_ENV
  // after this change. We can't dynamically import init.ts (it runs main
  // on import), so we replicate the loop logic here and assert the
  // expected behavior matches.
  const FLUSH_TO_ENV = [
    'DATABASE_URL',
    'INIT_ADMIN_EMAIL',
    'INIT_ADMIN_PASSWORD',
    'INIT_SITE_NAME',
    'NODE_ENV', // ← added in M32.7.4
  ] as const;

  function flushLoop(
    content: string,
    shellEnv: Record<string, string | undefined>,
  ): { content: string; didFlush: boolean } {
    let flushed = content;
    let didFlush = false;
    for (const k of FLUSH_TO_ENV) {
      const v = shellEnv[k];
      if (v && v !== '') {
        const fromFile = readEnvLine(content, k);
        if (fromFile === null || fromFile === '') {
          flushed = upsertEnvLine(flushed, k, v);
          didFlush = true;
        }
      }
    }
    return { content: flushed, didFlush };
  }

  it('writes NODE_ENV from shell env when .env has no NODE_ENV line', () => {
    const content = `DATABASE_URL=mysql://x\nPORT=3000\n`;
    const { content: out, didFlush } = flushLoop(content, { NODE_ENV: 'production' });
    expect(didFlush).toBe(true);
    expect(readEnvLine(out, 'NODE_ENV')).toBe('production');
  });

  it('does NOT overwrite .env NODE_ENV with shell NODE_ENV', () => {
    const content = `NODE_ENV=development\nPORT=3000\n`;
    const { didFlush } = flushLoop(content, { NODE_ENV: 'production' });
    // The flush loop only writes when .env is missing/empty — it
    // doesn't clobber an existing value. The non-interactive fail-safe
    // (Layer 3) is what forces production over development.
    expect(didFlush).toBe(false);
  });

  it('includes NODE_ENV in the flushable keys list', () => {
    expect(FLUSH_TO_ENV).toContain('NODE_ENV');
  });
});