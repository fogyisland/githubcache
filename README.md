# GitHub Metadata Cache

> A Node.js + Next.js service that caches GitHub repository metadata behind a public
> query API, with a multi-token pool, background refresh scheduler, and admin panel.

## Features

- POST /api/query — public GraphQL-style batch lookup for {owner, name} repos
- Per-key rate limiting (durable, DB-backed)
- Multi-token GitHub pool with quota persistence
- Background refresh scheduler with graceful stale-fallback when GitHub is down
- Cookie-session admin panel (users, api-keys, github-tokens, audit log, reports)
- Manual refresh + scheduler pause controls

## Quick Start

1. `cp .env.example .env` and fill in `DATABASE_URL` and `SESSION_SECRET`
2. `npm install`
3. `npx prisma migrate deploy`
4. `npm run dev`
5. `curl http://localhost:3000/api/v1/status`

## Scripts

- `npm run dev` — Next.js dev server (port 3000)
- `npm run dev:server` — dev mode with scheduler + pool (`tsx watch src/server.ts`)
- `npm run build` — production build (next build)
- `npm run start:server` — custom production server (Next + scheduler + pool)
- `npm run start` — Next.js production server only
- `npm run typecheck` — TypeScript strict-mode check
- `npm run lint` — ESLint
- `npm run format` — Prettier check (does not modify files)
- `npm run format:write` — Prettier write
- `npm test` — Vitest unit + integration tests
- `npm run test:e2e` — Playwright (requires dev server; not run in CI yet)
- `npm run dev:fetch` — dev helper for fetch debugging

## Environment Variables

All env vars are validated by `src/lib/config/env.ts` (zod schema).

| Var | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | MySQL connection URL |
| `SESSION_SECRET` | yes | dev fallback (≥32 chars) | Session cookie signing key |
| `PORT` | no | `3000` | HTTP port |
| `NODE_ENV` | no | `development` | Runtime mode (`development` / `production` / `test`) |
| `LOG_LEVEL` | no | `info` | pino log level (`fatal` / `error` / `warn` / `info` / `debug` / `trace`) |
| `SCHEDULER_BATCH_SIZE` | no | `10` | Refresh jobs per scheduler tick |
| `SCHEDULER_TICK_MS` | no | `60000` | Scheduler tick interval (ms) |
| `NIGHTLY_SWEEP_INTERVAL_MS` | no | `86400000` | Full re-check interval (ms) |
| `SCHEDULER_ENABLED` | no | `true` | Set `false` to disable background refresh |

GitHub tokens are managed in the database — add them via **`/admin/github-tokens`**.
The `GITHUB_TOKEN` / `GITHUB_TOKENS` / `GITHUB_TOKENS_FILE` env vars were removed in M21.

## Deploy

```bash
npm ci
npx prisma migrate deploy
npm run build
npm run start:server
```

`start:server` boots the custom server (`src/server.ts`) which mounts Next.js
together with the scheduler and the GitHub token pool.

For zero-downtime deploys, run this behind a process supervisor (systemd,
`pm2`, or your platform's app runner). The process handles `SIGTERM` /
`SIGINT` for graceful shutdown.

### Health Check

`GET /api/v1/status` returns:

- **200** with full body: `ok`, `db`, `tokens.{active,exhausted,total}`,
  `queue.{pending,in_progress,done,failed}`, `repositories.{total,ok,not_found,forbidden,error}`,
  `version.{commit,startedAt,nodeVersion}`, `timestamp`
- **503** with `ok: false`, `db: "down"` if the database is unreachable

Point your load balancer / orchestrator health check at this endpoint.

## Operations

For alerts, deploys, migrations, and incident response, see
**[docs/runbook.md](docs/runbook.md)**.

## Architecture

- `src/app/` — Next.js App Router pages and API routes (`src/app/api/v1/status`,
  `src/app/api/query`, `src/app/admin/*`)
- `src/lib/` — framework-agnostic business logic (no Next imports); modules
  include `lib/github/pool`, `lib/refresh/scheduler`, `lib/rate-limit/*`,
  `lib/audit/*`, `lib/auth/*`
- `src/server.ts` — custom server entry; mounts Next + scheduler + token pool
- `prisma/schema.prisma` — data model: `Repository`, `User`, `ApiKey`,
  `GithubToken`, `RefreshJob`, `AuditLog`, `Session`, `RateLimitBucket`,
  `Invitation`
- `prisma/migrations/` — versioned SQL migrations (apply with `prisma migrate deploy`)
- `tests/unit/` — Vitest unit tests
- `tests/integration/` — Vitest route-level tests
- `tests/e2e/` — Playwright end-to-end tests
- `docs/runbook.md` — operator runbook
- `docs/superpowers/` — design specs and implementation plan (SDD artifacts)

## Development

Local quality gates (CI enforces these):

- `npm run typecheck` — TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- `npm run lint` — ESLint
- `npm test` — Vitest unit + integration
- `npm run build` — Next.js production build

End-to-end tests (not in CI yet):

- `npm run test:e2e` — Playwright; requires a dev server running

CI: `.github/workflows/ci.yml` runs `lint` + `typecheck` + `unit` + `integration`
+ `build` on every pull request.

## License

Internal / TBD.