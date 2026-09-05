# GitHub Metadata Cache

> A Node.js + Next.js service that caches GitHub repository metadata behind a public
> query API, with a multi-token pool, background refresh scheduler, and admin panel.

## Features

- POST /api/query — public GraphQL-style batch lookup for {owner, name} repos
- Per-key rate limiting (durable, DB-backed)
- Multi-token GitHub pool with quota persistence
- **Auto-pause on rate-limit exhaustion** (M22) — scheduler sleeps until resetAt, no more 1Hz API spam
- Background refresh scheduler with graceful stale-fallback when GitHub is down
- Cookie-session admin panel (users, api-keys, github-tokens, audit log, reports)
- Manual refresh + scheduler pause controls
- **Per-user timezone** (M23) — admin dates render in operator's preferred IANA zone
- **Wulan theme** (M24) — light surface + sky-blue accent + 3 font flavors (terminal mono / editorial serif / brutalist display)

## Quick Start

1. `cp .env.example .env` and fill in `DATABASE_URL` and `SESSION_SECRET`
2. `npm install`
3. `npx prisma migrate deploy`
4. `npm run dev:server`  (or `npm run dev` for Next-only on a different port)
5. `curl http://localhost:5002/api/v1/status`

## Scripts

- `npm run dev` — Next.js dev server (port 5002, hardcoded in script)
- `npm run dev:server` — dev mode with scheduler + pool (`tsx watch src/server.ts`, port from `PORT` env)
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
| `PORT` | no | `5002` | HTTP port (custom server reads this) |
| `NODE_ENV` | no | `development` | Runtime mode (`development` / `production` / `test`) |
| `LOG_LEVEL` | no | `info` | pino log level (`fatal` / `error` / `warn` / `info` / `debug` / `trace`) |
| `SCHEDULER_BATCH_SIZE` | no | `10` | Refresh jobs per scheduler tick |
| `SCHEDULER_TICK_MS` | no | `60000` | Scheduler tick interval (ms) |
| `NIGHTLY_SWEEP_INTERVAL_MS` | no | `86400000` | Full re-check interval (ms) |
| `SCHEDULER_ENABLED` | no | `true` | Set `false` to disable background refresh |
| `PUBLIC_LOOKUP_RATE_PER_MIN` | no | `30` | Anonymous per-IP rate limit (M9) |
| `WEBHOOK_WORKER_TICK_MS` | no | `15000` | Webhook delivery worker cadence |
| `WEBHOOK_WORKER_BATCH_SIZE` | no | `25` | Max deliveries per worker tick |

GitHub tokens are managed in the database — add them via **`/admin/github-tokens`**.
The `GITHUB_TOKEN` / `GITHUB_TOKENS` / `GITHOKENS_FILE` env vars were removed in M21.

## Themes

Three public themes selectable via the lang switcher row (default = terminal):

| Theme | Surface | Accent | Type | Vibe |
|---|---|---|---|---|
| **terminal** | light + sky blue | #4A90E2 | JetBrains Mono everywhere | dense / data-heavy |
| **editorial** | light + sky blue | #4A90E2 | Fraunces serif display + IBM Plex Sans | newspaper / breath |
| **brutalist** | light + sky blue | #4A90E2 | Space Grotesk display + 2px borders | loud-but-blue |

All three share the **Wulan palette** (M24): bg `#FAFBFC`, surface `#FFFFFF`, ink
`#1A2B4A`, accent `#4A90E2`, accent-deep `#2C5F8E`. Themes differ only in font,
radius, and border weight — same color story, different visual rhythm.

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
  `lib/audit/*`, `lib/auth/*`, `lib/timezone/*` (M23), `lib/format/datetime.ts`
  (M23 TZ-aware formatter), `lib/admin/status-loader.ts` (M23 react-hooks/purity
  helper extraction)
- `src/server.ts` — custom server entry; mounts Next + scheduler + token pool
- `prisma/schema.prisma` — data model: `Repository`, `User` (with `theme`,
  `lang`, `adminVariant`, `timezone`), `ApiKey`, `GithubToken` (raw PAT in
  `token` column since M21), `RefreshJob`, `AuditLog`, `Session`,
  `RateLimitBucket`, `IpRateLimitBucket`, `WebhookSubscription`,
  `WebhookDelivery`, `IngestionProvider`, `Invitation`
- `prisma/migrations/` — versioned SQL migrations (apply with `prisma migrate deploy`)
- `tests/unit/` — Vitest unit tests
- `tests/integration/` — Vitest route-level tests
- `tests/e2e/` — Playwright end-to-end tests
- `docs/runbook.md` — operator runbook
- `docs/superpowers/` — design specs and implementation plan (SDD artifacts)

## Admin sections

| Section | Purpose |
|---|---|
| `/admin` | Dashboard — KPIs + recent activity feed |
| `/admin/users` | User management (invite, disable, reset password, logout-all) |
| `/admin/api-keys` | Issue / approve / revoke API keys |
| `/admin/github-tokens` | GitHub PAT pool management (M21 raw-PAT storage) |
| `/admin/repositories` | **Imported nodes** — every cached repo with status filter |
| `/admin/ingestion` | JSON-driven ingestion providers + run-now |
| `/admin/reports` | Usage reports (queries, errors, top keys, top repos) |
| `/admin/queries` | Recent API request log + drill-down |
| `/admin/refresh` | Scheduler state + manual refresh + pause controls |
| `/admin/queue` | Refresh job queue (pending / in-progress / done / failed) |
| `/admin/audit` | Audit log with filter by action / actor / target |
| `/admin/webhooks` | Webhook subscriptions + delivery history (M14) |
| `/admin/database` | MySQL backup / restore controls |
| `/admin/insights` | Cache health: stale repos, top queries, repo leaderboard |

The admin top utility row carries: variant pill · lang pill · **timezone `<select>`**
(M23) · theme pill · live UTC+local clock (M24) · logout.

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

## Milestone history

| M | Scope | Status |
|---|---|---|
| M0–M11 | Foundation: schema, sessions, scheduler, rate-limit, admin shell | shipped |
| M12 | Audit log + ingestion providers | shipped |
| M13 | User `lang` preference + login route persistence | shipped |
| M14 | Webhook subscriptions + delivery worker | shipped |
| M19 | JSON ingestion providers (schema drift fixed in M23 cleanup) | shipped |
| M20 | Queue-on-miss for `/api/query` (cache miss returns 202 pending + enqueues refresh) | shipped |
| M21 | DB-direct GitHub token storage (raw PAT in `github_tokens.token`; admin form activates immediately) | shipped |
| M22 | Rate-limit auto-pause: scheduler sleeps until GitHub `x-ratelimit-reset`, no 1Hz polling | shipped |
| M23 | Per-user timezone: `users.timezone` + `ghc_tz` cookie + 17-entry IANA allowlist + `Intl.DateTimeFormat('en-CA')` formatter; sweep across all admin pages | shipped |
| M24 | Wulan theme palette across all 3 public themes + 3 admin variants; `/admin/repositories/[owner]/[name]` detail; enriched public repo page (5 stats, versions, branches); admin top-bar UTC+local clock | shipped |

Each milestone has its own commit on `master` and (most) a memory file at
`~/.claude/projects/.../memory/`. See `docs/superpowers/` for the M21 / M23
implementation plans.