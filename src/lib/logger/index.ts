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

export const logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});
