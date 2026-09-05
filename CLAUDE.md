# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repo.

## What this is

`githubcache` — a Node.js + Next.js 14 service that caches GitHub repository
metadata behind a public query API, with a multi-token pool, background
refresh scheduler, and cookie-session admin panel. Single-machine deploy,
MySQL backend. ~870 vitest tests + several Playwright e2e tests.

**Status:** shipped through M24 (per-user timezone + Wulan theme). Master
branch on GitHub: https://github.com/fogyisland/githubcache

## Quick start

```bash
npm install
cp .env.example .env      # set DATABASE_URL + SESSION_SECRET
npx prisma migrate deploy
npm run dev:server        # custom server: Next + scheduler + pool, port 5002
curl http://localhost:5002/api/v1/status
```

For Next-only (no scheduler, no pool): `npm run dev` (also port 5002).

## Quality gates (run before claiming a task done)

```bash
npm run typecheck   # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm run lint        # ESLint, 0 errors required (warnings OK if pre-existing)
npm test            # vitest unit + integration
```

All three must be green. Pre-existing test failures (~6 of them) listed in
the M21 memory file — don't try to fix them unless the user asks.

## Architecture (one-line tour)

- `src/app/` — Next.js App Router. Public surface (`/`, `/repo/[owner]/[name]`,
  `/login`, `/api/v1/*`, `/api/query`) + admin surface (`/admin/*`).
- `src/lib/` — framework-agnostic business logic. **No Next imports here.**
  Subdirs: `auth/`, `github/`, `scheduler/`, `rate-limit/`, `audit/`,
  `webhooks/`, `theme/`, `lang/`, `admin/`, `timezone/`, `format/`.
- `src/server.ts` — custom server entry; mounts Next + scheduler + pool,
  listens on `PORT` (default 5002), handles SIGTERM/SIGINT.
- `prisma/schema.prisma` — data model. `users` has `theme`, `lang`,
  `adminVariant`, `timezone` (M23 nullable VARCHAR(64)).
- `prisma/migrations/` — versioned SQL. Apply with `prisma migrate deploy`.
  **Drift note:** m14_webhook_rename_secret is a no-op MODIFY COLUMN (the
  upstream migration used `secret` directly; rename never had a target).

## Critical conventions

### Server actions live in `src/app/_actions/`
Files in this dir MUST start with `'use server'`. Each exports a function
taking `(prevState, formData)` that returns a typed state object. Mirror
`setLangAction` / `setThemeAction` for new per-user preferences.

### i18n — strict namespaces
`next-intl` 4.x namespaces do NOT fall back to parent. Keys referenced from
a sub-namespace must be declared under that leaf. Both `messages/en.json`
and `messages/zh.json` must stay in sync — `tests/unit/i18n-coverage.test.ts`
enforces parity.

**t.rich trap:** callbacks in `t.rich(name, { tag: (chunk) => <jsx>{chunk}</jsx> })`
must accept the `chunk` argument and return JSX. No-arg `() => <jsx>...` callbacks
are silently dropped during SSR and the function gets stringified into the
DOM ("GET {function transformed} → ..."). If you need a runtime value
combined with a JSX wrapper, split into 4 fragments and compose inline —
see `src/app/repo/[owner]/[name]/_components/api-shape.tsx`.

### React 19 effect rule
`setState` synchronously inside `useEffect` triggers the cascading-render
linter error. Use `setTimeout(() => setNow(...), 0)` to defer the initial
tick, or `useSyncExternalStore` for external state. See
`src/app/_components/admin-clock.tsx`.

### Date formatting
**Do not** use `d.toISOString().slice(...)` for user-facing dates. Use
`formatDate` / `formatDateTime` / `formatTime` from `@/lib/format/datetime`
with a TZ-aware `TimezoneId` resolved via `resolveRequestTimezone`. The
ISO-slice pattern is reserved for API contracts (`/api/v1/status`,
webhook payloads, audit JSON metadata) where it's the machine contract.

### Admin component usage
Pages use shared atoms: `AdminPageHeader`, `AdminFilterBar`, `AdminTable`,
`AdminPagination`, `AdminStatusChip`, `AdminShell`. All in
`src/app/admin/_components/`. Don't reinvent these.

## Database

- MySQL 5.7+ via Prisma 5.22. `DATABASE_URL` in `.env`.
- Schema uses `@@map` for snake_case table names. **Always use the mapped
  name in raw SQL** (e.g., `users` not `User`).
- New migrations: `prisma/migrations/YYYYMMDDHHMMSS_<name>/migration.sql`
  then `npx prisma migrate dev --name <name>` (interactive — use `migrate
  deploy` in non-TTY shells). After any schema change, `npx prisma generate`.

## Memory

Project memories live at `~/.claude/projects/D--ToolDevelop-githubcache/memory/`.
Key files for context:

- `MEMORY.md` — index
- `project_m21_db_direct_tokens.md` — DB-direct GitHub token storage (M21)
- `project_m22_rate_limit_autopause.md` — auto-pause scheduler (M22)
- `project_m23_user_timezone.md` — per-user timezone (M23)
- `project_admin_imported_nodes_page.md` — `/admin/repositories` list (M24)
- `feedback_*.md` — recurring corrections (always read before any UI work)
- `feedback_no_docker.md` — no Docker, deploy is plain Node.js
- `feedback_no_window_in_client_components.md` — even 'use client' renders SSR first

## Common tasks

| Task | Steps |
|---|---|
| Add a new per-user preference (cookie + DB + action + switcher) | Mirror lang/theme/timezone: `src/lib/<pref>/{constants,registry,cookie,resolve}.ts`, `src/app/_actions/set-<pref>.ts`, `src/app/_components/<pref>-switcher.tsx`, wire into `src/app/admin/layout.tsx`, extend login route to persist on success, add i18n keys in both `messages/*.json`. |
| Add a new admin page | Copy `src/app/admin/api-keys/page.tsx`; use AdminPageHeader + AdminFilterBar + AdminTable + AdminPagination; register slug in `src/app/admin/_components/admin-sidebar.tsx` + `messages/*.json` `admin.shell.sections`. |
| Add a new API route | Place under `src/app/api/<version>/<name>/route.ts`; export named HTTP-method functions. Validate session + CSRF for mutating routes. Rate-limit per IP and per API key. |
| Add a new Prisma model | Edit `prisma/schema.prisma`; create migration with `@@map` for snake_case; run `prisma generate`; helper functions go in `src/lib/db/<model>.ts`. |
| Add a new scheduled job | Extend `src/lib/scheduler/tick.ts` `runTick()`; respect `isPaused()`; if work is per-resource, use `claimBatch()` to lease with `lockedUntil`. |

## Operational notes

- **No Docker** — deploy is plain Node.js behind systemd / pm2 / k8s pod.
  Per `feedback_no_docker.md`.
- **Port 5002** — both `npm run dev` (hardcoded) and `dev:server` (env).
- **Scheduler tick 60s default** — can be lowered to 1s in dev via
  `SCHEDULER_TICK_MS=1000` in `.env`.
- **Pool is in-memory** — Next.js dev HMR resets the pool Map. For long
  smoke tests use `npm run build && NODE_ENV=production npm run start:server`.
- **GitHub token rotation** — DB-direct since M21. Add new tokens via
  `/admin/github-tokens`; pool is updated immediately, no restart needed.
- **Rate-limit auto-pause** — scheduler pauses when all tokens exhausted,
  resumes at `x-ratelimit-reset` + 1s buffer. Verify with `grep
  "auto-paused" logs` or watch `/admin/refresh` state.

## Things that will trip you up

1. **`Date.now()` in async server component** body triggers
   `react-hooks/purity` lint. Extract to a non-component helper in `src/lib/`.
   See `src/lib/admin/status-loader.ts`.
2. **`next/headers cookies()`** throws in Vitest. Mock it (see
   `tests/integration/timezone-persistence.test.ts` for the pattern).
3. **Prisma `@@map` + raw SQL** — write the SQL with the mapped snake_case
   name, not the camelCase model name.
4. **Module-level state + HMR** — `pool.ts` Map gets reset by Next dev HMR.
   Pin on `globalThis` for long-lived state in dev. Production is fine.
5. **t.rich callbacks** without `chunk` argument — see "i18n" section above.
6. **setState in useEffect** — React 19 cascading-render lint. Defer with
   setTimeout(0).

## Do NOT

- Add new npm dependencies without asking — most needs are met by current deps.
- Touch API contracts (`/api/v1/*`, webhook payloads) without coordinating —
  they're machine-readable and consumed by other services.
- Put `setTimeout`/`setInterval` at module top level — they leak across HMR.
- Use `localStorage` / `window` in any code path that might SSR.
- Skip typecheck/lint/test before claiming a task done.
- Amend commits or rewrite git history.
