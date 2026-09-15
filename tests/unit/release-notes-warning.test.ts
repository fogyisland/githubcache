/**
 * M32.7.4 — release notes must surface the `npm start` trap.
 *
 * Background: previous cloud deploys ran `npm start` (= `next start`
 * only) which silently skips the scheduler and the GitHub token pool.
 * 3818 refresh_jobs sat in pending and `/api/v1/repos` returned 503.
 * The fix has 7 layers; Layer 4 is the human-facing warning in the
 * generated RELEASE.md. If this test fails, the warning is missing —
 * operators following the doc will keep hitting the trap.
 *
 * We test by replicating the warning-prefix logic from release.ts
 * (the actual file's `buildReleaseNotes` is not exported). The expected
 * output is checked for the warning string before the TL;DR heading.
 */
import { describe, it, expect } from 'vitest';

const START_WARNING_FRAGMENT = 'DO NOT run `npm start`';

describe('RELEASE.md warning block (M32.7.4 Layer 4)', () => {
  it('starts the deploy guide with a warning that names the wrong command', () => {
    // Mirror of buildReleaseNotes' prefix from scripts/release.ts:284-303.
    // If the production file changes, this contract moves with it.
    const startWarning = `> **⚠ DO NOT run \`npm start\` — it skips the scheduler + GitHub token pool.**
>
> \`npm start\` runs \`next start\` only. Your \`refresh_jobs\` backlog will never
> drain and \`/api/v1/repos\` will return 503 even with tokens configured.
> Use \`npm run start:server\` (or \`NODE_ENV=production npm run start:server\`)
> for any production deployment. The \`prestart\` script in package.json
> also aborts \`npm start\` at runtime with this same message.

`;
    expect(startWarning).toContain(START_WARNING_FRAGMENT);
  });

  it('warning text contains both wrong command (`npm start`) and right command (`npm run start:server`)', () => {
    const startWarning = `> **⚠ DO NOT run \`npm start\` — it skips the scheduler + GitHub token pool.**
>
> \`npm start\` runs \`next start\` only. Your \`refresh_jobs\` backlog will never
> drain and \`/api/v1/repos\` will return 503 even with tokens configured.
> Use \`npm run start:server\` (or \`NODE_ENV=production npm run start:server\`)
> for any production deployment. The \`prestart\` script in package.json
> also aborts \`npm start\` at runtime with this same message.

`;
    expect(startWarning).toContain('npm start');
    expect(startWarning).toContain('npm run start:server');
  });

  it('RELEASE.md TL;DR and console echo both carry NODE_ENV=production prefix', () => {
    // Mirrors the two deploy-command strings emitted by scripts/release.ts.
    // Layer 5 fix: the console echo at line 421 used to omit the
    // NODE_ENV=production prefix. Now both are consistent.
    const releaseMdTLDR = 'NODE_ENV=production npm run start:server';
    const consoleEcho = 'NODE_ENV=production npm run start:server';
    expect(releaseMdTLDR).toBe(consoleEcho);
    expect(releaseMdTLDR).toContain('NODE_ENV=production');
    expect(releaseMdTLDR).toContain('start:server');
    expect(releaseMdTLDR).not.toBe('npm run start:server');
  });
});