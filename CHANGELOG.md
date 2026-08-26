# Changelog

All notable changes to GitHub Metadata Cache, organized by milestone tag.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once a stable release is cut. Until then, milestone tags serve as the version anchor.

---

## [m9-project-site] — 2026-08-26

**Project-site frontend.** Public-facing homepage with a GitHub repo lookup
form, per-IP rate limit for anonymous users, and a `/repo/[owner]/[name]`
detail page. Existing `/api/query` API-key path and admin SPA unchanged.

### Added

- `IpRateLimitBucket` model + `m9_ip_rate_limit_buckets` migration.
  Parallel to `RateLimitBucket` but keyed on client IP (VarChar(45) — IPv4
  or IPv6). Same atomic semantics (SELECT ... FOR UPDATE in transaction).
- `checkIpRateLimit(ip, perMinute)` — mirrors `checkRateLimit` (M8.1).
- `lookupRepo(owner, name)` helper in `src/lib/cache/lookup.ts` — extracted
  from `/api/query` per-node logic. Reused by the homepage server action
  and the `/repo/[owner]/[name]` detail page.
- Server action `lookupAction(formData)` at `src/app/_actions/lookup.ts` —
  zod-validated owner/name, per-IP rate limit (default 30/min via
  `PUBLIC_LOOKUP_RATE_PER_MIN` env), TRUST_PROXY-aware IP extraction,
  `revalidatePath('/')` on success.
- Homepage (`/`) — project-style landing: hero, tagline, lookup form,
  recent lookups (top 8 cached repos), footer with status/admin links.
- Repo detail page (`/repo/[owner]/[name]`) — server component rendering
  full metadata (stars, forks, watchers, language, license, topics,
  default branch, homepage, created/updated/pushed dates) with a
  `loading.tsx` skeleton for cold-cache path and `not-found.tsx` for
  not_found rows.
- Recent-lookups DB helper `recentLookups(limit)` in
  `src/lib/db/repositories.ts`.

### Env

- `PUBLIC_LOOKUP_RATE_PER_MIN` (default 30) — per-IP per-minute limit for
  the public form. Protects the GitHub token pool from anonymous abuse.
- `TRUST_PROXY` (default false) — trust `X-Forwarded-For` / `X-Real-IP`
  for client IP. Set true when behind a reverse proxy.

### Stats

- 9 commits (M9.1 → M9.7), 13 new files, 2 modified
- 187 unit tests + 10 new ip-rate-limit tests + 10 new public-lookup-action
  tests = 207 vitest tests (offline-compatible suites)

### Migration

- `npx prisma migrate deploy` to apply `m9_ip_rate_limit_buckets`.

### Breaking changes

None. All M9 features are additive. `/api/query` refactored to use
`lookupRepo` internally — same wire contract.

### Changed (post-tag polish)

- Full CSS / UI overhaul after M9 SHIP. Inter via `next/font/google`;
  `globals.css` adds theme tokens (`--color-bg`, `--color-surface`, ...),
  custom `@layer components` (`ghc-card`, `ghc-card-hover`, `ghc-link`,
  `ghc-stat`, `ghc-chip`, `ghc-input`, `ghc-btn-primary`, `ghc-btn-ghost`),
  and animations (`ghc-shimmer`, `ghc-hero-gradient`, `ghc-fade-up`,
  `:focus-visible` ring).
- New `<SiteHeader />` — sticky top nav with brand logo, "Status" / "Admin"
  links; rendered in root layout.
- Detail page `loading.tsx` upgraded from generic pulse to a structured
  shimmer skeleton (hero + stats + cards).
- Detail page `not-found.tsx` styled as a centered empty-state.
- Lookup form / result card / recent-lookups list re-skinned with the new
  component classes and inline SVG icons (alert, warning, clipboard,
  external-link, GitHub mark).

### Fixed

- Detail page + lookup result card + recent-lookups list were reading raw
  GitHub field names (`stargazers_count`, `forks_count`, ...) but the cache
  stores the **parsed** shape (`stars`, `forks`, ...) from
  `parseRepoResponse`. Stars/Forks/Watchers/License all rendered as `–`.
  New `src/lib/repo/metadata.ts` exposes typed getters
  (`getStars`, `getForks`, `getWatchers`, `getDefaultBranch`,
  `getLanguage`, `getLicenseName`, `getTopics`, `getHomepage`, `getCreatedAt`,
  `getUpdatedAt`, `getPushedAt`, `getHtmlUrl`, `formatCount`, `formatDate`)
  — detail page, lookup-result-card, recent-lookups-list now use them.
  28 unit tests in `tests/unit/repo-metadata.test.ts`.

---

## [m10-three-themes] — 2026-08-26

**Three opinionated visual themes + live switcher.** Replaces the single M9
CSS with three distinct, deliberately-designed themes that any visitor (or
admin) can switch between. Cookie-persisted for anon visitors, DB-persisted
on `users.theme` for logged-in users. No flash — the server reads the cookie
in the layout pass and sets `data-theme="<id>"` before paint.

### Themes

| ID | Mood | Palette anchor | Display | Body | Mono |
|---|---|---|---|---|---|
| `terminal` | Late-night dev / shell session | signal green `#7EE787` on near-black `#0A0E0A` | JetBrains Mono | JetBrains Mono | JetBrains Mono |
| `editorial` | Technical journal, light paper | NYT-style red `#B73E3E` on cream `#FBFAF6` | Fraunces (serif, italic) | IBM Plex Sans | IBM Plex Mono |
| `brutalist` | Bold geometric, oversized numerals | electric blue `#0033FF` on paper white | Space Grotesk 700 | Inter | JetBrains Mono |

Editorial uses the serif *only* on the detail-page repo name (single accent
on each page). Brutalist bumps stat numerals to `clamp(3.5rem, 7vw, 6.5rem)`.

### Added

- `Theme` Prisma enum + `users.theme` column (`m10_user_theme` migration).
  Default = `terminal`.
- `src/lib/theme/themes.ts` — single source of truth: `THEME_IDS`, `THEMES`
  metadata (label / blurb / mood / font tokens), `isThemeId`, `resolveTheme`.
- `src/lib/theme/cookie.ts` — `readThemeFromCookieHeader`, `readThemeFromRequest`,
  `buildThemeSetCookie`. Validates against registry, falls back to default.
- `src/app/_actions/theme.ts` — `setThemeAction` server action. Always sets
  the cookie; if the viewer is logged in, also persists `users.theme` so the
  preference follows them across devices. `revalidatePath('/', 'layout')`
  for instant repaint.
- `src/app/_components/theme-switcher.tsx` — three pill buttons (T / E / B)
  with `aria-pressed` reflecting current theme. Uses `useFormState` +
  `useFormStatus` for pending state.
- Embedded in `<SiteHeader />` (visible to every visitor, top-right) and in
  the admin layout chrome.
- New theme-attribute CSS layer in `globals.css` with three token sets
  (`--color-bg`, `--color-accent`, `--font-display`, `--font-serif`, etc.)
  plus per-theme overrides for `ghc-display-headline`, `ghc-display-name`,
  `ghc-stat-number`. Component classes (`ghc-card`, `ghc-btn-primary`,
  `ghc-link`, `ghc-chip`, `ghc-input`) read from variables — one-attr change.
- New `ghc-status` chip + `[OK]/[404]/[ERR]` prefix on result cards (terminal
  signature), `ghc-prompt` + blinking cursor (terminal hero), `ghc-rule` /
  `ghc-eyebrow` / `ghc-masthead` (editorial density), `ghc-mega-stat` /
  `ghc-block-accent` (brutalist scale), `ghc-theme-row` / `ghc-theme-pill`
  (switcher UI itself).

### Migration

- `npx prisma migrate deploy` to apply `m10_user_theme`. New `users.theme`
  column defaults to `terminal` for existing rows.

### Stats

- 12 commits, 8 new files, 6 modified
- 17 new theme unit tests (`tests/unit/theme.test.ts`)
- 232 vitest tests total (offline-compatible suite)

### Breaking changes

None. The previous M9 polish CSS is replaced wholesale; component class
names (`ghc-card`, `ghc-btn-primary`, etc.) remain so no callers needed
updates.

---

## [m8-prod-ready] — 2026-08-26

**Deployment + Observability.** Production-ready observability surface, durable rate-limit,
 audit escalation on terminal refresh, full status endpoint, CI, deploy docs.

### Added

- `GET /api/v1/status` — full health + observability endpoint (db ping, token summary,
  queue counts, repository counts, version). Returns 503 on DB unreachable.
- `/api/query` returns `stale: true` + warning `'data may be delayed'` when GitHub is
  unreachable and a cached row exists. New `summary.stale` field counts stale results.
- `refresh.failed_review` audit action written when a refresh job hits 5 consecutive
  404s or 5 consecutive unexpected errors. Metadata includes `kind: 'not_found' | 'unexpected'`.
- Durable per-key rate-limit bucket (DB-backed `RateLimitBucket` model). 429 responses
  now include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers.
- GitHub Actions CI: 4-job workflow (lint-typecheck, unit, integration, build) on
  Node 20 with a MySQL 5.7.44 service for the integration job. Concurrency control
  cancels in-progress runs on the same ref.
- `docs/runbook.md` — operator-facing alert playbook (5 alert types), migrations,
  incident response, disaster recovery.
- README rewritten with Quick Start, env var table, deploy procedure, architecture,
  development, CI reference.

### Changed

- README: replaced pnpm references with npm (we migrated in `ddc0aa0`).
- `audit-filters.tsx` dropdown updated to include `refresh.failed_review`.
- `.env: ` now documents optional scheduler knobs (`SCHEDULER_BATCH_SIZE`,
  `SCHEDULER_TICK_MS`, `NIGHTLY_SWEEP_INTERVAL_MS`, `SCHEDULER_ENABLED`).
- `scripts/dev-fetch.ts` usage hint fixed (`pnpm` → `npm`).
- `doneLast24h` count in `/api/v1/status` parallelized into the main `Promise.all`.

### Removed

- Initial M8.6 Dockerfile multi-stage image (per user direction: deploy is plain Node.js,
  no Docker). See `docs/runbook.md` for the Node deploy procedure.

### Stats

- 9 commits (M8.1 → M8.docker-revert), 4 new + several modified files
- Tests: ~410+ passing across unit + integration suites
- Files added: `src/lib/rate-limit/bucket.ts`, `src/lib/db/rate-limit.ts`,
  `tests/integration/api-rate-limit-durable.test.ts`,
  `tests/integration/api-query-stale.test.ts`,
  `tests/integration/api-v1-status.test.ts`, `.github/workflows/ci.yml`,
  `docs/runbook.md`

### Breaking changes

None. All M8 features are additive or replace existing internal implementations
(e.g., `repo_not_found_escalation` → `refresh.failed_review`, in-memory token bucket →
durable bucket).

---

## [m7-admin-spa] — 2026-08-25

**Admin SPA depth.** Full admin UI for users, api-keys, github-tokens, reports, audit
log, manual refresh, queue pause.

### Added

- Users CRUD + invitations (admin-only).
- `/admin/api-keys` list + detail with rate-limit/quota editing.
- `/admin/github-tokens` list with add/disable/delete (token plaintext consumed and
  discarded on insert; only label/first4/last4/hash persisted).
- `/admin/reports` page with Tailwind + Recharts (KPI cards, requests-over-time,
  top repos, top keys, token quota).
- `/admin/audit` log search with URL-based filters (action, actor, target type, date range).
- `/admin/refresh` for manual refresh triggers + scheduler pause/resume.
- Playwright e2e test for happy-path admin flow.

### Stats

- 358 vitest + 2 playwright tests
- Tailwind v4 + Recharts installed

---

## [m6-admin-auth] — 2026-08-24

**Cookie-session admin auth.** Replaces dev-token with real session cookies + CSRF.

### Added

- `Session` + `Invitation` schema (bcrypt cost 12, session-id Char(43)).
- Cookie-session auth (`validateSession` + sliding renewal under 4h remaining).
- CSRF protection via Web Crypto API (Edge-runtime safe).
- Login throttle (per-email + per-IP).
- `POST /api/admin/auth/login`, `/logout`, `GET /csrf`.
- Invitation flow + password reset (admin-initiated).
- `src/middleware.ts` redirects unauthenticated `/admin/*` and enforces CSRF on
  `/api/admin/*` non-GET.

### Stats

- 241 tests passing

---

## [m5-scheduler] — 2026-08-23

**Scheduler + aging.** Refresh job lifecycle + background workers.

### Added

- `RefreshJob` schema + lease helper (`locked_until`).
- Aging policy (`ok` → 24h, `forbidden` → 24h, `not_found` → 24h, `error` → 5min).
- Single-refresh worker (`refresh-one.ts`) with conditional GET (304).
- Scheduler tick (`runTick`) + nightly sweep (`nightlySweep` for `priority=99`).
- Custom server boot (`src/server.ts`) — Next + scheduler + pool, with graceful
  SIGTERM/SIGINT shutdown.

### Stats

- 151 tests passing

---

## [m4-token-pool] — 2026-08-22

**Multi-token GitHub pool.**

### Added

- `GithubToken` schema + DB helpers.
- Multi-token loader (env, file, comma-separated).
- Pool with `pickToken` (quota-aware) + `recordUsage` (quota persistence every 25 calls
  or 60s) + 429 exponential backoff.

---

## [m3-api-keys] — 2026-08-21

**API key request + approval flow.**

### Added

- `ApiKey` schema + DB helpers.
- `POST /api/admin/api-keys/request` (operator) + `POST /api/admin/api-keys/[id]/approve` (admin).
- X-API-Key auth middleware on `/api/query`.
- Per-key `rateLimitPerMin` + `dailyQuota` enforcement.

---

## [m2-public-api] — 2026-08-20

**Public API base.**

### Added

- `POST /api/query` — batched `{owner, name}` lookup with `result.canonical` + `result.original`.
- Node parser, write-through cache, error model (`fetch_status`: `ok | not_found | error`).

---

## [m1-data-path] — 2026-08-19

**Data path.** Single-token GitHub fetch + repository cache.

### Added

- `Repository` schema (`@unique([owner, name])`).
- `fetchRepoCore` + `parseRepoResponse` + `storeRepoMetadata` (UPSERT).
- `dev:fetch` CLI script for debugging.

---

## [m0-foundation] — 2026-08-18

**Project skeleton.**

### Added

- Next.js 14 (App Router) + TypeScript strict + ESLint + Prettier + Vitest + Playwright.
- Prisma 5 + MySQL.
- Zod env validation (`src/lib/config/env.ts`).
- Pino logger (`src/lib/logger.ts`).
- Conventional Commits + SDD methodology established.

---

## Earlier milestones (pre-SDD)

This repository uses Subagent-Driven Development (SDD) starting from M0. The project
was conceived in `docs/superpowers/specs/2026-08-14-github-metadata-cache-design.md`
and `docs/superpowers/specs/2026-08-15-implementation-strategy-design.md`.

For sub-task details within each milestone, see
`.superpowers/sdd/2026-08-15-github-metadata-cache-implementation/progress.md`.