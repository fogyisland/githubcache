/**
 * M32.7.4 — Layer 7: `prestart` script trap.
 *
 * Background: cloud operator ran `npm start` (which executes `next start`
 * only — no scheduler, no pool, no dbReady). The fix installs a
 * `prestart` npm hook that aborts before `start` runs, with a clear
 * pointer to the right command.
 *
 * This test pins TWO things:
 * 1. The package.json `prestart` script must exist and contain the
 *    abort-on-error shape (`process.exit(1)` + FATAL message).
 * 2. Running `npm start` (via `npm run start`) must exit non-zero with
 *    the FATAL message on stderr.
 *
 * (1) is a source-level invariant — a regression to "no prestart"
 * would re-enable the silent failure mode. (2) is end-to-end and uses
 * `npm run start` against the actual package.json, so a refactor that
 * keeps the trap working still passes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('package.json `prestart` trap (M32.7.4 Layer 7)', () => {
  it('declares a prestart script that aborts with process.exit(1)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts).toHaveProperty('prestart');
    expect(pkg.scripts.prestart).toContain('process.exit(1)');
    // The message must mention the wrong command and point to the fix.
    expect(pkg.scripts.prestart).toMatch(/npm start/i);
    expect(pkg.scripts.prestart).toMatch(/start:server/);
  });

  it('keeps the original `start` script for compatibility (next start)', () => {
    // Some deploy systems (12-factor platforms, pm2 ecosystem, Procfile)
    // auto-detect `npm start`. We don't break them — we add a guard.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toBe('next start -p 5002');
  });

  it('npm run start aborts with non-zero exit + correct message (end-to-end)', () => {
    // Run from the repo root. npm executes `prestart` then `start`; if
    // prestart exits non-zero, the chain halts and `start` never runs.
    // On Windows, execFileSync('npm.cmd', ...) needs `shell: true` —
    // without it the .cmd wrapper swallows the streams (status: null,
    // empty buffers). shell:true routes through cmd.exe and captures
    // both streams correctly.
    let exitCode: number | null = 0;
    let stdout = '';
    let stderr = '';
    try {
      const out = execFileSync('npm.cmd', ['run', 'start'], {
        cwd: resolve(__dirname, '../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_loglevel: 'silent' },
        shell: true,
      });
      stdout = out.toString();
    } catch (e) {
      const err = e as { status: number | null; stdout?: Buffer; stderr?: Buffer };
      exitCode = err.status;
      stdout = err.stdout?.toString() ?? '';
      stderr = err.stderr?.toString() ?? '';
    }
    // The prestart must abort — exit code must NOT be 0.
    expect(exitCode).not.toBe(0);
    // The FATAL message must reach whichever stream npm used.
    // We don't pin which stream npm picks — just the combined text.
    const combined = stdout + stderr;
    expect(combined).toMatch(/FATAL.*npm start/i);
    expect(combined).toMatch(/start:server/);
  }, 30_000);
});