/**
 * M28.bug17 — pre-import env defaults for npm run start:server.
 *
 * ES module imports are hoisted to the top of the file — they execute
 * BEFORE any other top-level code. That means `process.env.NODE_ENV ??=
 * 'production'` written after `import next from 'next'` runs TOO LATE:
 * Next.js reads NODE_ENV at module-load time and ships
 * `react.development.js` to the browser if it sees 'development' (or
 * undefined → defaults to 'development'). The dev React bundle then
 * crashes on every admin page render with:
 *
 *   TypeError: Cannot read properties of undefined (reading 'startTime')
 *     at et.reportAllChanges
 *
 * Fix: this file sets the defaults FIRST, then dynamic-imports
 * src/server.ts and invokes `bootServer()` directly. We can't rely on
 * server.ts's `isMainModule` check because `process.argv[1]` still
 * points to bootstrap.ts when the dynamic import runs.
 *
 * Only loaded by `npm run start:server`. dev:server uses tsx directly
 * on server.ts, so dev mode is unaffected (dev mode wants NODE_ENV
 * undefined or 'development' anyway).
 */

export {};

import { DEFAULT_DEV_PORT } from './lib/config/dev-port';
// M32.7.4 — last-line-of-defense against NODE_ENV misconfiguration.
// See src/lib/bootstrap-node-env.ts for rationale. Runs BEFORE the
// dynamic import('./server.js') below because Next.js reads NODE_ENV
// at module-load time and ships react.development.js if it sees
// 'development'.
import { enforceProductionNodeEnv } from './lib/bootstrap-node-env.js';

const env = process.env as Record<string, string | undefined>;
enforceProductionNodeEnv(env);
if (!env.PORT) env.PORT = String(DEFAULT_DEV_PORT);

const { bootServer } = await import('./server.js');

const handle = await bootServer();
console.log('[bootstrap] server up on port', env.PORT);

const shutdown = async (signal: string): Promise<void> => {
  console.log('[bootstrap] received', signal);
  try {
    await handle.shutdown();
  } catch (e) {
    console.error('[bootstrap] shutdown error:', e);
  }
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});