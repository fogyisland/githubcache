import { PrismaClient } from '@prisma/client';

// M28.bug16 — build must succeed without DATABASE_URL (next build runs
// on the server before /init has written it). So we can't construct the
// PrismaClient eagerly here — that would throw at module-load time.
//
// Instead, export `prisma` as a Proxy that lazily constructs the
// underlying PrismaClient on first property access. The construction
// throws a clear "DATABASE_URL is not set — visit /init" message if
// the URL is still missing. Middleware redirects every non-/init
// request to /init, so the user always sees the wizard before any DB
// query fires.
//
// Trade-off: the Proxy intercepts every method call with a small
// indirection. This is fine for our admin-only /api/v1/* / /api/admin/*
// routes that don't run in a hot loop. The scheduler's hot path uses
// `@/lib/db/repositories` which calls prisma.user.findFirst etc — those
// hit the Proxy once per call, acceptable overhead.

let realClient: PrismaClient | null = null;

function ensureClient(): PrismaClient {
  if (realClient) return realClient;
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is not set. The deployment has not been initialized yet — ' +
        'visit /init in your browser to complete the wizard.',
    );
  }
  // M11.16 — bump connection-pool ceiling so rate-limit high-concurrency
  // tests don't queue past Prisma's 5s transaction_timeout.
  const url = new URL(rawUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '32');
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '30');
  }
  process.env.DATABASE_URL = url.toString();
  realClient = new PrismaClient({ log: ['error', 'warn'] });
  return realClient;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop: string | symbol) {
    const client = ensureClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as Function).bind(client) : value;
  },
});