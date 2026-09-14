import { pino } from 'pino';

// Read directly from process.env (NOT via the @/lib/config/env Proxy) so
// logger module-load doesn't trigger env validation. The wizard needs to
// import logger on /init/* before .env exists; accessing env.DATABASE_URL
// at module top would throw ZodError and break setup.
//
// Defaults match env.ts's schema defaults. If you add a new logger knob,
// mirror it in env.ts and keep these defaults in sync.
const level = process.env.LOG_LEVEL ?? 'info';
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
// LOG_PRETTY=false forces raw JSON output even in dev — the pino-pretty
// worker thread crashes under Next.js dev HMR (worker chunk gets evicted
// from .next/server/vendor-chunks but the worker handle is still alive).
// Operators set this in .env to silence the noise; see the project
// memory file `project_dev_pino_pretty_worker_quirk.md`.
const prettyEnv = process.env.LOG_PRETTY;
const usePretty = prettyEnv === undefined ? isDev : prettyEnv !== 'false';

export const logger = pino({
  level,
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});
