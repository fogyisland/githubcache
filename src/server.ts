import { createServer } from 'node:http';
import next from 'next';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { initPool, shutdownPool } from '@/lib/github/pool';
import { startScheduler, stopScheduler } from '@/lib/scheduler';
import { startupDatabaseChecks } from '@/lib/database/startup';

/**
 * Custom server entry — `npm run dev:server` boots this directly with
 * tsx (no `tsx watch`). Changes to most of `src/` are picked up by Next's
 * built-in dev HMR, but a few kinds of edits need a manual Ctrl+C +
 * restart:
 *
 *   1. `src/server.ts` itself (this file).
 *   2. `src/lib/db/client.ts` — Prisma client is a process-level singleton
 *      and the query engine DLL is loaded once at boot.
 *   3. `src/lib/github/pool.ts` — pool Map is module-level singleton
 *      (CLAUDE.md "Things that will trip you up" #4); changes won't
 *      take effect on the running process.
 *   4. `prisma/schema.prisma` or any new migration — `prisma generate`
 *      reloads the generated client; the runtime needs a fresh process
 *      to load it.
 *   5. `src/lib/config/env.ts` — env parsing runs once at boot.
 *
 * For everything else (admin pages, server components, API routes,
 * cache/, scheduler/ workers, github/ fetchers), Next's HMR rebuilds
 * the affected route automatically — no restart needed.
 *
 * If you change one of (1)–(5) above, Ctrl+C the running dev:server
 * and `npm run dev:server` again. There's intentionally no `watch` —
 * the double-rebuild cost (tsx restarts server.ts → Next detects
 * restart → recompiles middleware → full HMR cycle) outweighs the
 * occasional manual step.
 */

interface ServerHandle {
  server: ReturnType<typeof createServer>;
  scheduler: { stop(): void };
  shutdown(): Promise<void>;
}

/**
 * Boot the production server: Next.js HTTP handler + scheduler + token pool.
 *
 * Idempotent: each call creates fresh resources. Tests should call this once
 * per test run, then shutdown() to clean up.
 *
 * Returns a ServerHandle with the underlying HTTP server (for port binding
 * inspection in tests) and a shutdown() method that orchestrates graceful
 * shutdown in dependency order:
 *   1. Stop accepting new HTTP requests (server.close)
 *   2. Stop scheduler (prevents new refresh jobs from claiming tokens)
 *   3. Flush + shutdown token pool (persists quota, clears persist interval)
 *   4. Close Prisma connection pool
 */
export async function bootServer(): Promise<ServerHandle> {
  const app = next({ dev: env.NODE_ENV !== 'production' });
  const handle = app.getRequestHandler();
  await app.prepare();

  // M28.bug16 — fresh deploys have no DATABASE_URL until /init runs.
  // Start the HTTP handler so the wizard is reachable, but skip the
  // scheduler + token pool (both need DB). After the operator runs
  // /init and restarts the process, full boot resumes.
  const dbReady = !!process.env.DATABASE_URL;
  if (dbReady) {
    await initPool();
    await startupDatabaseChecks();
  } else {
    logger.warn(
      'DATABASE_URL not set — starting in setup mode. Run /init, then restart the server.',
    );
  }

  const scheduler = dbReady ? startScheduler() : { stop: () => undefined };

  const server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT, mode: dbReady ? 'full' : 'setup' }, 'listening');
      resolve();
    });
  });

  return {
    server,
    scheduler,
    async shutdown() {
      logger.info('shutting down');
      // 1. Stop accepting new connections (close existing after they finish)
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      // 2. Stop scheduler (no new refresh jobs)
      scheduler.stop();
      // 3. Flush + shutdown token pool
      if (dbReady) {
        await shutdownPool();
        // 4. Close Prisma connection pool (imported lazily to avoid circular deps)
        const { prisma } = await import('@/lib/db/client');
        await prisma.$disconnect();
      }
      logger.info('shutdown complete');
    },
  };
}

/** Test helper — stops the singleton scheduler if started. */
export function shutdownScheduler(): void {
  stopScheduler();
}

// Production entrypoint: only run when invoked directly (not when imported by tests).
// Detect via comparing `import.meta.url` to `process.argv[1]`.
const isMainModule = (() => {
  try {
    // Node 20+: import.meta.url is available
    return import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  bootServer()
    .then((handle) => {
      const shutdown = async (signal: string) => {
        logger.info({ signal }, 'received shutdown signal');
        try {
          await handle.shutdown();
        } catch (e: unknown) {
          logger.error({ err: e }, 'error during shutdown');
        }
        process.exit(0);
      };
      process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
      });
      process.on('SIGINT', () => {
        void shutdown('SIGINT');
      });

      process.on('uncaughtException', (err: Error) => {
        logger.error({ err }, 'uncaughtException');
      });
      process.on('unhandledRejection', (reason: unknown) => {
        logger.error({ reason }, 'unhandledRejection');
      });
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'failed to boot server');
      process.exit(1);
    });
}
