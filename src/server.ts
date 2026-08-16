import { createServer } from 'node:http';
import next from 'next';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import { initPool, shutdownPool } from '@/lib/github/pool';
import { startScheduler, stopScheduler } from '@/lib/scheduler';

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

  await initPool();

  const scheduler = startScheduler();

  const server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT }, 'listening');
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
      await shutdownPool();
      // 4. Close Prisma connection pool (imported lazily to avoid circular deps)
      const { prisma } = await import('@/lib/db/client');
      await prisma.$disconnect();
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
