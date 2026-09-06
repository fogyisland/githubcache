# Changelog

All notable changes to GitHub Metadata Cache, organized by milestone tag.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once a stable release is cut. Until then, milestone tags serve as the version anchor.

---

## [m26x-auth-repo] — 2026-09-06

**`/api/v1/repos/[owner]/[name]` is now authenticated.**

The single-repo public lookup used to be anonymous with a per-IP
rate limit (`PUBLIC_LOOKUP_RATE_PER_MIN`, default 30/min). M26.x
tightens this:

- `X-API-Key` header is required. Missing → `401 unauthorized`.
  Invalid / revoked / disabled → `403 forbidden`.
- Rate limit is now per-key per-hour: `PUBLIC_REPO_RATE_PER_HOUR`,
  default 50 000. Hourly window aligned to wall-clock hours via the
  existing durable `rate_limit_buckets` table — no new schema, no
  new helper. The `checkRateLimit` helper now takes an explicit
  `windowMs` so the same code path serves both the per-minute
  `/api/query` and the new per-hour `/api/v1/repos` limits.
- `recordRequest` rows now carry `apiKeyId` so `/admin/queries`
  can attribute single-repo traffic to its owner.
- The 4xx error table on `/docs/api/v1-repos` gains
  `401-missing_api_key` and `403-invalid_api_key`. The
  `429-rate_limit_exceeded` entry now points at the per-key
  hourly bucket instead of the per-IP minute bucket.
- The docs landing rate-limits grid changes from
  "Public lookup (per-IP)" → "Authenticated single-repo lookup
  (per-key, per-hour)" so the three-tier model still maps cleanly
  to the public contract.
- `/get-started` step 4 example 2 (single-repo curl) now shows
  the `X-API-Key` header. Example 1 (status) stays public. The
  homepage `api-doc-section` curl example also gains the
  `X-API-Key` header.

The 50 000/hour ceiling matches the M26 signup rate limit, so the
two user-facing caps in the service share the same order of
magnitude (~14 req/sec sustained) and an operator reading the
docs sees consistent numbers.

---

## [m19-providers] — 2026-08-31

**`/admin/providers` — JSON-driven ingestion sources.**
Operators can declare a `slug / kind=file|http / itemsPath / urlField`
configuration and have the cache ingest every GitHub `owner/name` pair
the source returns. Designed to be useful even when no GitHub tokens
are configured (preview + classify against the existing
`repositories` table work without tokens; only the eventual
`refreshJob` fetch requires them).

### Pages

| Route | Purpose |
|---|---|
| `/admin/providers` | List view. AdminTable over `ingestion_providers`. New button → `/admin/providers/new` |
| `/admin/providers/new` | Create form (admin-only) |
| `/admin/providers/[id]` | Edit form with Preview button, Toggle + Delete actions |
| `/admin/ingestion` | New "Run via provider" card below the recent-jobs table |

### Added

**Library — `src/lib/ingestion/providers/`**
- `schema.ts` — Zod discriminated union (`kind: 'file' | 'http'`)
  with `ProviderConfigSchema` + `parseProviderConfig`.
- `jsonpath.ts` — minimal JSONPath evaluator supporting `$.a.b.c`,
  `$.a[0]`, `$.a[*].b`, `$.a[*][N]`, `$.a[*][*]`. Sticky regex tokenizer;
  `JsonPathError` on unsupported / malformed paths.
- `extract.ts` — `parseGitHubUrl(input)` — accepts `https://github.com/o/n[.git]`,
  `git@github.com:o/n[.git]`, scheme-less forms; returns `{owner, name}` or `null`.
- `source.ts` — `loadProviderSource(config, opts)`:
  - File source gated by `PROVIDER_FILE_ROOTS` (comma-separated absolute
    dirs); resolves and enforces `isUnder(child, parents)` containment.
  - HTTP source via `fetch` with optional `headers` + `AbortSignal`.
  - Throws typed `ProviderSourceError` with `code ∈ {FILE_NOT_FOUND,
    FILE_OUT_OF_ROOTS, HTTP_ERROR, JSON_PARSE, BAD_ITEMSPATH}`.
- `run.ts` — `previewProvider(slug, opts)` + `runProvider(slug, opts)`:
  - `extractUniquePairs()` — load → evaluateJsonPath(itemsPath) →
    per-item urlField → `parseGitHubUrl` → dedupe.
  - `classifyAgainstDb()` — `existing_ok` (fetch_status='ok' AND
    `last_fetched_at` IS NOT NULL) / `stale` (everything else in DB) /
    `new` (not in DB). Returns up to 20 sample pairs.
  - `runProvider(dryRun=true)` is a pure preview. `dryRun=false`
    upserts repository stubs + enqueues `refresh_jobs` (priority 70)
    for stale + new rows in a single transaction.
- `db.ts` — thin CRUD helpers: `listProviders` / `getProviderById` /
  `getProviderBySlug` / `createProvider` / `updateProvider` / `deleteProvider`.

**API — `src/app/api/admin/providers/`**
- `GET /api/admin/providers` — list, optional `?enabled=true|false` filter
  (admin+operator).
- `POST /api/admin/providers` — create (admin-only). Rejects duplicate
  slug. Audit-logged.
- `GET /api/admin/providers/[id]` — read one (admin+operator).
- `PATCH /api/admin/providers/[id]` — partial update; slug immutable;
  config re-parsed on every write (admin-only). Audit-logged.
- `DELETE /api/admin/providers/[id]` — remove (admin-only). Audit-logged.
- `POST /api/admin/providers/[id]/toggle` — flip `enabled` (admin-only).
  Audit-logged.
- `POST /api/admin/providers/[id]/preview` — preview (admin+operator).
  Returns `{ totals, sample, poolEmpty }`.
- `POST /api/admin/providers/[id]/run` — run (admin+operator). Returns
  `{ totals, jobCount, dryRun, poolEmpty }`. Audit-logged on `dryRun=false`.
  `poolEmpty=true` warns the UI that jobs will fail at fetch.

**Pages**
- `/admin/providers/page.tsx` — admin-only list. Reads via
  `listProviders()`. New button in page-header actions.
- `/admin/providers/new/page.tsx` — admin-only. Renders
  `<ProviderForm mode="create">`.
- `/admin/providers/[id]/page.tsx` — admin-only. Pre-fills form via
  `ProviderConfigSchema.parse(row.configJson)`. Renders `<ProviderToggle>`
  + `<ProviderDelete>` in the page-header actions slot.
- `_components/provider-form.tsx` — shared client form (create/edit).
  Kind=file vs http branching; itemsPath + urlField inputs;
  enabled checkbox; slug immutability on edit.
- `_components/provider-actions.tsx` — Toggle button client island.
- `_components/provider-delete.tsx` — Delete button client island with
  confirmation prompt.
- `/admin/ingestion/_components/run-via-provider.tsx` — Run-via-Provider
  client island. Fetches provider list + CSRF in parallel; exposes
  `<select>` + limit + dryRun + Preview/Run buttons; shows
  `poolEmptyWarning` banner when the run/preview response carries
  `poolEmpty: true`.

**Sidebar**
- New slug `providers` (icon `⊡`, admin-only) added to `admin-sidebar.tsx`
  between `ingestion` and `audit`. Routes to `/admin/providers`.
- `/api/admin/palette/route.ts` extended with the new section (also adds
  `ingestion` which was previously missing from the palette payload).

**Migration**
- `prisma/migrations/m19_ingestion_providers/migration.sql`:
  ```sql
  CREATE TABLE ingestion_providers (
    id BIGINT NOT NULL AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'json',
    config_json JSON NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY ingestion_providers_slug_unique (slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  ```
  Uses `utf8mb4_unicode_ci` (not `utf8mb4_0900_ai_ci`) — the MySQL 8.0
  default is unavailable on this project's MySQL 5.7.44 instance.

**i18n**
- New namespace `admin.providers.*` in both `messages/en.json` and
  `messages/zh.json`: `title / description / breadcrumbAdmin /
  breadcrumbProviders / sourceType / status / field / list.{heading,
  emptyTitle, emptyDescription, column} / form.{createHeading,
  editHeading, slugHelp, namePlaceholder, fileHeading, filePathLabel,
  filePathPlaceholder, httpHeading, urlLabel, urlPlaceholder,
  itemsPathLabel, itemsPathPlaceholder, itemsPathHelp, urlFieldLabel,
  urlFieldPlaceholder, urlFieldHelp, submitCreate, submitEdit,
  submittingCreate, submittingEdit} / actions.{edit, delete, enable,
  disable, preview, run, confirmDelete} / runCard.{heading, description,
  chooseProvider, noProviders, dryRun, limitLabel, submitPreview,
  submitRun, previewResult.{items, urls, unique, existing, stale, new,
  invalid}, poolEmptyWarning, runOk, previewOk, previewFailed,
  runFailed, createFailed}`.
- New sidebar section key `admin.shell.sections.providers` (zh: "数据源",
  en: "Providers").

**Tests**
- `tests/unit/ingestion-providers-schema.test.ts` — 16 tests.
- `tests/unit/ingestion-providers-jsonpath.test.ts` — 19 tests.
- `tests/unit/ingestion-providers-extract.test.ts` — 18 tests.
- `tests/unit/ingestion-providers-source.test.ts` — 16 tests
  (mocks `fs` + global `fetch`).
- `tests/integration/ingestion-providers.test.ts` — 6 tests against
  the shared test DB. Unique `TEST_OWNER_PREFIX = 'm19-fixture'` to
  avoid collisions with other tests.
- `tests/unit/admin-ingestion-i18n.test.tsx` — extended mock list to
  include the new `<RunViaProvider />` island.

**Env**
- `PROVIDER_FILE_ROOTS` (default unset) — comma-separated absolute
  directories allowed as file-source roots. Each file path is resolved
  and must be inside one of these roots or the loader throws
  `FILE_OUT_OF_ROOTS`.

### Stats

- 11 commits (M19.1 → M19.11), 16 new files, 6 modified
- 69 new unit tests + 6 new integration tests = 75 new M19 tests
- typecheck ✓ / lint ✓ (0 errors)

### Breaking changes

None. All M19 features are additive. Sidebar grew by one entry.

---

## [m20-queue-on-miss] — 2026-08-31

**Cache miss now queues to `refresh_jobs` instead of synchronous fetch.**
`lookupRepo` enqueues a stub repository + refreshJob (priority 70) on
cache miss and returns `fetch_status: 'pending'` with `queuedAt` /
`scheduledFor`. The scheduler tick (1 job / 1 s) drains the queue and
writes back to `repositories`; subsequent queries hit cache.

### Behaviour

| Path | Old (M19) | New (M20) |
|---|---|---|
| `POST /api/query` cache hit | `fetch_status: 'ok'` | unchanged |
| `POST /api/query` cache miss | synchronous `fetchRepoCore` → `ok` / `error` | enqueue → `fetch_status: 'pending'` |
| `POST /api/query` `fetch_status: 'not_found'` | terminal | unchanged (still terminal) |
| `POST /api/query` `fetch_status: 'error'` row | re-fetched in request path | re-enqueued (returns `pending`) |
| `GET /api/v1/repos/[owner]/[name]` cache miss | `503 fetch_status: 'error'` | `202 fetch_status: 'pending'` + `queued_at` + `scheduled_for` |
| `/repo/[owner]/[name]` cache miss | `notFound()` (404) | minimal pending page with enqueue notice |
| `Summary` shape | `hit / miss / stale` | `hit / pending / not_found / error / stale` |
| Scheduler tick | up to 10 concurrent jobs | 1 job / tick (1 req/s ceiling) |

### Changed files

- `src/lib/cache/lookup.ts` — `lookupRepo` no longer fetches. `ResultPending`
  added; `enqueueRefresh()` upserts a stub repository row + creates
  `refreshJob` (priority 70, scheduledFor=now) with a duplicate-pending
  guard for in-flight concurrency.
- `src/app/api/query/route.ts` — summary adds `pending` counter alongside
  `hit / not_found / error / stale`; `cache_hit` requires no pending or
  error rows.
- `src/app/api/v1/repos/[owner]/[name]/route.ts` — pending branch returns
  `202 Accepted` with `queued_at` + `scheduled_for`.
- `src/app/repo/[owner]/[name]/page.tsx` — pending branch renders a minimal
  page instead of `notFound()`.
- `src/app/_components/lookup-result-card.tsx` — `[QUEUE]` chip in
  accent color; renders enqueue timestamps.
- `.env` — `SCHEDULER_BATCH_SIZE=1`, `SCHEDULER_TICK_MS=1000`.

### Tests

- `tests/integration/api-query-stale.test.ts` — five stale-path tests
  rewritten for queue-on-miss semantics (no `firstMiss`, no `fetchRepoCore`
  mock needed). New tests for terminal `not_found` (no re-enqueue) and
  retryable `error` (re-enqueue → pending).
- `tests/integration/query.test.ts` — `beforeEach` cleanup deletes
  `refreshJobs` before repositories (FK). Two tests rewritten: cache
  miss now asserts pending + queuedAt + refreshJob exists; concurrent
  first-miss now asserts single refreshJob (not single upstream call).
- `tests/integration/scheduler-tick.test.ts` — "processes multiple
  pending jobs concurrently" renamed to "processes one job per tick at
  SCHEDULER_BATCH_SIZE=1, drains on subsequent ticks" — asserts 1 done
  per tick, full drain after 3 ticks.
- `tests/integration/api-keys-flow.test.ts` — same FK cleanup fix.
- `tests/integration/api-v1-status.test.ts` — `tokens.total` /
  `tokens.exhausted` assertions switched to delta-based (capture baseline
  before seeding; assert `+3` / `+1`) so the test tolerates other
  in-flight tokens in the shared DB.

838 / 840 tests passing. 2 pre-existing failures unrelated to M20:
missing i18n key `docs.landing.errorCodes.codes.payload_too_large` and
`reports-recent-requests` pagination test data contamination.

### Breaking changes

- `POST /api/query` summary shape: added `pending` field; `miss` field
  removed (replaced by `pending`).
- `GET /api/v1/repos/[owner]/[name]` cache miss now returns `202`
  (was `503`); the response carries `fetch_status: 'pending'` plus
  `queued_at` and `scheduled_for`.
- Anonymous `/repo/[owner]/[name]` cache miss now returns `200` with a
  pending notice (was `404`).

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

## [m11-detailed-surfaces] — 2026-08-27

**Detailed admin redesign + public site rework.** Three independent admin
design directions (mission_control / inspector / workbench), parallel to the
three-theme public system. Cookie + DB dual persistence, URL-synced filter
bars, command palette, native `<dialog>` confirm flow, live status bar, and
four new public depth sections (stats / features / how-it-works / API doc /
quick-try / footer).

### Admin variants

| ID | Mood | Palette anchor | Display | Body | Mono |
|---|---|---|---|---|---|
| `mission_control` | 24/7 ops bridge, signal-saturated | signal amber `#F5A524` on slate `#0F172A` | JetBrains Mono | Inter | JetBrains Mono |
| `inspector` | Quiet case-file study, generous whitespace | ink black `#1A1815` on cream `#F4EFE6` | IBM Plex Serif | Inter | IBM Plex Mono |
| `workbench` | Maker's bench, precise + airy | electric blue `#1D4ED8` on paper white | Space Grotesk | Inter | JetBrains Mono |

Each variant sets its own `--admin-*` tokens; the same component markup
reads them, so we don't fork components per variant. Mission Control is
the default and gets a persistent bottom status bar (db ms / queue depth /
scheduler state / 24h audit count / operator meta). Inspector and
Workbench get a clean nav strip. All three share the command palette
(⌘K / Ctrl+K) and the role-gated sidebar.

### Added

**Variant foundation**
- `AdminVariant` Prisma enum + `users.admin_variant` column
  (`m11_user_admin_variant` migration). Default = `mission_control`.
- `src/lib/admin/variant.ts` — registry, `resolveAdminVariant`,
  `ADMIN_VARIANT_IDS`, `DEFAULT_ADMIN_VARIANT`. Mirror of theme module.
- `src/lib/admin/cookie.ts` — `ghc_admin_variant` cookie helpers
  (`readAdminVariantFromCookieHeader`, `readAdminVariantFromRequest`,
  `buildAdminVariantSetCookie`).
- `src/app/_actions/admin-variant.ts` — `setAdminVariantAction` server
  action. Cookie always; `users.admin_variant` for logged-in users.
  `revalidatePath('/', 'layout')` for instant repaint.

**Admin atoms (M11.3)**
- `<AdminChip>`, `<AdminEmptyState>`, `<AdminPageHeader>` (breadcrumb /
  title / eyebrow / actions slot), `<AdminKpiCard>` (label / value / hint /
  tone). All variant-aware via `--admin-*` tokens.

**Admin table + filter (M11.4)**
- Generic typed `<AdminTable<T>>` with `<AdminColumn<T>>` row template
  binding. Row-level `rowHref` for click-through to detail.
- `<AdminFilterBar>` — URL-synced GET form with role/status chips. Preserves
  pagination on submit.

**Status bar + confirm dialog + palette/status APIs (M11.5)**
- `GET /api/admin/status` — db ping ms / queue depth / scheduler state /
  recent audit count / operator meta. Polls every 10 s from client.
- `GET /api/admin/palette` — sections (role-gated) + 5 most recent audit
  entries. Prefetched server-side; consumed by command palette.
- `<AdminStatusBar>` — 5-up status column row, only renders for
  `mission_control`. PAUSED scheduler state gets warn-tone accent.
- `<AdminConfirmDialog>` — native `<dialog>`, `useFormStatus` pending
  state, no third-party modal lib.

**Shell + sidebar + 3-variant CSS layer (M11.6)**
- `<AdminShell>` (sidebar + main) + `<AdminSidebar>` (7 sections,
  client-side role filter, `ghc-admin-sidebar-current` active accent +
  `aria-current`). 3-variant CSS attribute layer
  (`[data-admin="mission_control"]` / `[data-admin="inspector"]` /
  `[data-admin="workbench"]`).

**Command palette (M11.7)**
- Native `<dialog>`. Listens for ⌘K/Ctrl+K + `ghc:open-palette` window
  event. Case-insensitive filter across section title/slug + audit
  action/actor. Arrow-key highlight, Enter navigates. SSR-prefetched data.

**Layout rewrite (M11.8)**
- `admin/layout.tsx` now wraps children in `<AdminShell>` +
  `<CommandPalette>` + utility bar (variant/theme switcher + logout).
- Middleware (`src/middleware.ts`) sets `x-pathname` on `/admin/*` so the
  server layout can highlight the active sidebar section without a
  client round-trip.

**Admin page rewrites (M11.9–M11.12)**
- Dashboard: 4 `<AdminKpiCard>` (cached repos / active users / active API
  keys / active GitHub tokens with contextual hints + tones) + 6h bar
  chart (CSS-flexbox column bars with inline height) + recent-activity
  feed (top-5 audit entries with chips).
- Users list (`/admin/users`): filter (role/status) + `<AdminTable<User>>`
  (rowHref → detail) + InviteForm + pending invitations table.
- API Keys list (`/admin/api-keys`): status filter + `<AdminTable<KeyRow>>`
  with chips (active=ok / pending=warn / revoked=danger).
- GitHub Tokens list (`/admin/github-tokens`): quota warning when ≥ 80 %
  utilisation + pool-size hint + AddTokenForm +
  `<AdminTable<TokenRow>>` (status + pool-state chips + usage %).
- Detail pages: `/admin/users/[id]`, `/admin/api-keys/[id]`,
  `/admin/github-tokens/[id]`. `<AdminPageHeader>` breadcrumb + profile
  `<dl>` + role actions + recent-activity table.
- Minimal-touch: `/admin/reports`, `/admin/audit`, `/admin/refresh`
  (`<AdminPageHeader>` + `ghc-admin-page` wrapper).

**Public site depth (M11.13–M11.15)**
- `<StatsBar>` — live counts from `/api/v1/status`, animated
  count-up via `requestAnimationFrame` + cubic ease. Renders 0s
  immediately (no layout shift).
- `<FeaturesSection>` — 3-up grid (Instant / Cached / Rate-limited + API)
  with inline SVG icons.
- `<HowItWorks>` — 3 numbered steps with inline SVG diagrams (form /
  cache / JSON). Numbered rail only because order is load-bearing here.
- `<ApiDocSection>` — curl example + trimmed JSON response shape
  (request/response two-card grid).
- `<QuickTry>` — 3 server-action buttons (torvalds/linux, microsoft/vscode,
  vitejs/vite). Each fires the existing `lookupAction` and routes to
  `/repo/{owner}/{name}` on success.
- `<SiteFooter>` — 3-column meta strip (brand + tagline / version +
  GitHub link / status JSON + admin login). Version read from
  `package.json` at build time.
- `<ApiShape>` — collapsible `<details>` block on `/repo/[owner]/[name]`
  with the full JSON dump and a `GET /api/v1/repos/...` reference link.
- `<SiteHeader>` Status / Admin links demoted from `ghc-btn-ghost` to
  the new muted `ghc-header-util-link` style (smaller, lower-contrast,
  focus-visible ring).
- CSS additions: `.ghc-api-doc` / `.ghc-code-block` / `.ghc-quick-try` /
  `.ghc-quick-try-btn` / `.ghc-site-footer` (with `*-col`, `*-brand`,
  `*-heading`, `*-list`, `*-fine`) / `.ghc-header-util-link` /
  `.ghc-api-shape` (collapsible details + summary chevron).

### Env

None added. Variant + theme preference persistence uses the existing
cookie + `users.*` columns.

### Migration

- `npx prisma migrate deploy` to apply `m11_user_admin_variant`. New
  `users.admin_variant` column defaults to `mission_control` for existing
  rows.

### Stats

- 16 commits (M11.1 → M11.15), ~30 new files, ~20 modified
- ~2 500 lines of code added (CSS heavy — three full visual variants +
  six new public depth sections)
- 518 passing tests (61 test files). Two pre-existing MySQL-concurrency
  deadlock flakes in `api-rate-limit-durable.test.ts` and
  `ip-rate-limit.test.ts` are unrelated to M11 (they were last touched in
  M8 / M9.2 and fail intermittently under shared-DB contention).

### Breaking changes

None. The variant attribute switches the admin visual layer only; no
admin route, form, or API contract changed. Public site additions are
purely additive (no existing classes or routes modified besides
`<SiteHeader>` link styling).

---

## [m12-api-docs] — 2026-08-28

**Public, themed API documentation site at `/docs/*`.** Zod schemas are
the single source of truth for request/response shape — if a route
changes, the docs are out of sync at typecheck time.

### Added

- **Public routes**: `/docs`, `/docs/api/v1-status`, `/docs/api/v1-repos`,
  `/docs/api/query`. Themed to share the existing terminal / editorial /
  brutalist visual system.
- **New API**: `GET /api/v1/repos/{owner}/{name}` — public single-repo
  lookup, per-IP rate limited, reuses `lookupRepo` (M9.3). Closes the
  gap where `api-shape.tsx` referenced a non-existent route.
- **Schema layer**: `src/lib/api-docs/schemas/{v1-status,v1-repos,query}.ts`
  — Zod schemas for all 3 endpoints. The status route now validates its
  outgoing payload against `v1StatusSchema`. The `/api/query` response
  schema mirrors the actual `QueryResult` shape (canonical, original,
  found, metadata, last_fetched_at, fetch_status, stale, warning?).
- **Registry**: `src/lib/api-docs/registry.ts` — `ENDPOINT_DOCS` ordered
  array of `EndpointDoc`, `findEndpointBySlug(slug)`.
- **Components**: `<DocsShell>`, `<DocsSidebar>`, `<EndpointPage>`,
  `<CurlExample>`, `<SchemaViewer>` (recursive Zod walker with union
  branch labels), `<ResponseExample>`, `<HeadersTable>`, `<ErrorsTable>`,
  `<CopyButton>`.
- **CSS**: `ghc-doc-*` classes in `globals.css` reading existing
  variables. Three-theme compatibility inherited. `--space-*` scale
  defined in `:root`.

### Out of scope

- Interactive "Try it" (mocked browser execution).
- OpenAPI export.
- Admin endpoint documentation.

### Migration

None. Purely additive.

### Stats

- Test count: 547 (522 → 547, +25 across new unit + integration suites).
- Files added: 17. Files modified: 4.
- 4 pre-existing MySQL-concurrency flakes (api-rate-limit-durable,
  ip-rate-limit, admin-refresh, admin-api-keys) are unrelated to M12
  and last touched in M8 / M9.2.

### Breaking changes

None. `GET /api/v1/repos/{owner}/{name}` is purely additive.

---

## [m13-i18n] — 2026-08-29

**Full-site Chinese + English translation.** Every user-visible string on the
public site, admin SPA, login page, and `/docs/*` now switches with the
`ghc_lang` cookie. Cookie-persisted for anonymous visitors, DB-persisted
on `users.lang` for logged-in users (cross-device preference). No flash —
the root layout reads the cookie in the request pass and sets `lang="<id>"`
on `<html>` before paint.

### Added

- **i18n foundation** — `next-intl@4.x` wired in. `src/i18n/config.ts` exports
  `LOCALES = ['zh','en'] as const`, `defaultLocale = 'zh'`, `Locale` type.
  `src/i18n/request.ts` resolves the locale from cookie → Accept-Language →
  default via `resolveLocale`. `src/lib/lang/{cookie,registry,constants}.ts`
  mirror the theme cookie module: `ghc_lang` cookie (1-year Max-Age,
  Path=/, SameSite=Lax), `isLocale` type guard, `readLangFromCookieHeader`,
  `buildLangSetCookie`.
- **Prisma migration** — `users.lang` column added (`m13_user_lang`
  migration, default `'zh'`, NOT NULL VarChar(8)).
- **Server action** — `setLangAction(locale)` at `src/app/_actions/set-lang.ts`.
  zod-validated locale, always sets `ghc_lang` cookie (anon + logged-in),
  persists to `users.lang` when a session is present, `revalidatePath('/', 'layout')`.
- **Lang switcher** — `<LangSwitcher>` client component in the site header
  utility bar, mirroring the theme switcher shape (two pill buttons
  "中" / "EN" with `aria-pressed`, `useFormState` + `useFormStatus`).
- **Translated surfaces** — every page that renders user-visible chrome now
  reads from `messages/{zh,en}.json`:
  - **Root chrome** — root layout (`<html lang>` set, title/description
    templates), `<SiteHeader>`, `<SiteFooter>`.
  - **Public site** — homepage (`/`), `/repo/[owner]/[name]` detail page,
    `/login`.
  - **Admin SPA** — `admin/layout.tsx` shell + command palette + status bar;
    users list + detail + invite form + actions; api-keys list + detail +
    actions + limits form; github-tokens list + detail + add form + actions;
    reports; audit; manual refresh.
  - **Docs site** (`/docs/*`) — landing page + 3 endpoint pages (`v1-status`,
    `v1-repos`, `query`) + 9 widgets (`endpoint-page`, `docs-sidebar`,
    `curl-example`, `copy-button`, `response-example`, `headers-table`,
    `errors-table`, `schema-viewer`). Registry data (summary, description,
    rate-limit, parameter/header descriptions, error `when` strings) is
    translated at render time via `getTranslations` lookup keyed by
    endpoint slug; falls back to raw registry value on missing keys.
  - **Login route** — `POST /api/admin/auth/login` reads `ghc_lang` from
    the request cookie and persists it on `users.lang` (parallel to the
    existing `lastLoginAt` write).

### Strict namespace discipline

`next-intl@4` namespaces do **not** fall back to parent keys
(`getTranslations('a.b.c').raw('x.y')` does NOT resolve `a.x.y`). Where a
sub-namespace references keys that logically belong to a sibling leaf
(e.g. `admin.users.detail` referencing `role.admin` from `admin.users.role`),
the block is mirrored under the leaf. Mirrors applied in `admin.users.detail`,
`admin.apiKeys.detail`, `admin.githubTokens.detail`, and
`docs.endpoint.{api-v1-status,api-v1-repos,api-query}`.

### Out of scope

- Right-to-left layouts (no RTL content).
- URL-prefixed locales (e.g. `/en/...`). Cookie + DB preference only.
- Admin endpoint documentation (`/admin/api-keys` etc. remain English-only;
  the docs site documents the public API surface).

### Migration

- `npx prisma migrate deploy` to apply `m13_user_lang`.
- No data backfill — the column defaults to `'zh'`, so every existing user
  starts Chinese on first login after the deploy.
- **Known issue (parked for M13.x):** the migration SQL
  `prisma/migrations/m13_user_lang/migration.sql` line 1 uses `ALTER TABLE
  \`User\`` but the User model is `@@map("users")` — the migration is
  rejected by Prisma on any fresh DB. Worked around on the live test DB
  by applying equivalent SQL and `prisma migrate resolve --applied`. The
  migration file itself needs a one-line fix in a follow-up task.

### Stats

- 13 commits (M13.1 → M13.12), 98 files changed (+6778 / -845).
- 23 new i18n tests across `tests/unit/{docs-i18n,login-i18n,home-i18n,
  repo-detail-i18n,admin-users-i18n,admin-api-keys-i18n,admin-github-tokens-i18n,
  admin-reports-i18n,admin-audit-i18n,admin-refresh-i18n,admin-shell-i18n,
  lang-switcher,i18n-config,i18n-coverage}.test.ts(x)` and
  `tests/integration/lang-persistence.test.ts`. Coverage test enforces
  zh/en parity across all message keys (3/3 pass).
- 9 test files updated for the async-conversion ripple: existing
  `admin-*.test.ts` mocks added `vi.mock('next-intl/server'|'next-intl', …)`
  with `.rich` support for `t.rich`; existing `docs-*` / `schema-viewer`
  tests gained async + new `endpointNs` prop coverage.

### Breaking changes

None. All M13 features are additive. The login route's response shape is
unchanged; `users.lang` is read-only from the login route's perspective.
Server action response shape (`SetLangState`) is internal — never crossed
the wire before.

---

## [m13.x follow-ups] — 2026-08-29

**Post-M13 cleanup round.** Six follow-up commits under the same
`m13-i18n` tag — final-review blocker + 4 M13.x.1–x.5 fixups from review
parking-lot + 1 missed-from-finalization artifact commit.

### Fixed

- **Migration SQL table name** (`cf2fd62`) — `m13_user_lang/migration.sql`
  line 1 was `ALTER TABLE \`User\`` but the User model is `@@map("users")`.
  Renamed to `users`. `prisma migrate deploy` now succeeds on a clean DB
  (was previously worked-around on the live test DB only).
- **Admin LangSwitcher active indicator** (`5e67fcf`) — the admin layout's
  lang cookie read used `cookieStore.get('cookie')` (raw header string,
  not a real cookie name), so the active button always showed the
  default `zh` active regardless of the user's choice. Switched to
  `cookieStore.get(LANG_COOKIE)?.value` with `dbValue: user.lang` fallback
  from the user record. (Same trap caught in M11.8 for admin variant.)
- **Lang-switcher a11y** (`6b1ae25`) — `LangButton` now takes an explicit
  `ariaLabel` prop; `LangSwitcher` builds it from the `switchTo` template
  + `fullLabel.{zh,en}` keys so screen readers hear "Switch to Chinese" /
  "Switch to English" instead of the bare "中" / "EN" pill label. An
  `sr-only` status mirror with `data-lang-state` + `data-current-lang`
  surfaces server-action state for tests + assistive tech.
- **Admin shell tests async fix** (`43e8acf`) — `tests/unit/admin-shell.test.tsx`
  used `createElement(AdminShell, ...)` synchronously, but `AdminShell` is
  an async server component returning `Promise<ReactElement>`; React threw
  "Objects are not valid as a React child (found: [object Promise])" on
  all 5 cases. Refactored to `await AdminShell({...})` directly with `vi.mock('next-intl/server')` + `vi.mock('next-intl')` mock setup. 13/13 admin shell/status-bar/palette tests now pass.

### Added

- `npm run smoke:session` (`900b2fd`) — wires `scripts/smoke-session.ts`
  into `package.json`. One-off helper that creates a session for the
  first active admin user and prints `SESSION_ID` + `USER_EMAIL` +
  `EXPIRES_AT` for curl-based smoke testing of admin endpoints. Same
  `tsx --env-file=.env` pattern as `create:admin`.
- M13 spec + plan (`e8efce6`) — `docs/superpowers/plans/2026-08-28-m13-i18n.md`
  (342 lines) + `docs/superpowers/specs/2026-08-28-m13-i18n.md` (183
  lines). These artifacts were created during M13 brainstorming but
  missed from M13.13 finalization; now committed for future contributors
  to reference.

### Changed

- `.gitignore` (`5ebcc19`) — removed stale `.pnpm-store/` entry. Project
  uses npm (verified: `package-lock.json` present, no `pnpm-lock.yaml`,
  no `.pnpm-store/` directory). Cosmetic cleanup from M8 era.
- **Admin layout lint clean** (`f4f404d`) — extracted the admin status
  prefetch logic (DB ping + queue depth + 24h audit count + recent
  audit rows for the palette) into `src/lib/admin/status-loader.ts`.
  The 3 pre-existing `react-hooks/purity` errors from `Date.now()`
  calls in the function-component body are now silenced — the helper
  is a plain async function (not a component, not PascalCase), so the
  rule does not apply. `eslint src/app/admin/layout.tsx` is now clean
  (was 3 errors before).

### Fixed

- **3 pre-existing failing integration tests** (`8063460`) — since
  M13.9/M13.11 these have been red:
  - `tests/integration/api-docs-routes.test.ts` — threw
    `getTranslations is not supported in Client Components` (landing
    page calls `getTranslations`) and `Objects are not valid as a
    React child (found: [object Promise])` (3 endpoint pages
    returned `<EndpointPage doc={doc} />` as JSX — React rejects
    Promise-as-JSX-child in the non-RSC renderToStaticMarkup path).
  - `tests/integration/repo-detail-api-shape.test.ts` — same JSX-
    Promise failure for `<ApiShape>` rendered inside `RepoOkView`'s
    JSX tree.
  - `tests/integration/public-lookup-action.test.ts` — `getTranslations`
    mock missing from the action test path. Also assertion drift: the
    test asserted `/boom/` on the error message, but M13.9 changed the
    action to surface a translated generic "lookup failed" message
    (lookup.ts:111) instead of the raw error.
  Fix: pre-await `EndpointPage` in the 3 docs route pages; pre-await
  `<ApiShape>` inside `RepoOkView`'s JSX; add `vi.mock('next-intl/server')`
  + `vi.mock('next-intl')` to all 3 test files with labels map per
  namespace + `.rich()` support that flattens React-element chunks to
  strings (recursive walk over `.props.children`). Update assertion to
  `/failed|error/i`. 3/3 files pass individually, 16/16 tests green.

### Stats

- 8 commits (`cf2fd62` → `8063460`), 5 files modified + 3 created
  (the two new docs + the wired-in smoke-session script + the new
  status-loader helper) + 4 modified in the integration-test fix.
- Test suite: 13/13 admin shell tests now pass (was 5/13 with the async
  component bug pre-fix). 16/16 in the 3 fixed integration tests
  (was 13/16, 3 fail, pre-fix). Full unit suite green (51 files, 359
  tests). ESLint clean on `src/app/admin/layout.tsx` (was 3 errors
  pre-fix).

---

## [m14-polish-round] — 2026-08-29

**User-driven polish round.** Six focused follow-up commits addressing
gap items surfaced after M13.i18n — admin UX depth, public docs clarity,
operational hardening, and a dependency sweep. No tag applied yet at
the time of writing; this entry is added after `m14-polish-round` is
cut.

### Added

- **M14.1 — Audit log CSV/JSON export** (`3e45cac`). `format=csv|json`
  query param on `GET /api/admin/audit`. Extracted `buildAuditWhere()`
  to `src/lib/db/audit.ts` so the page filter and the export route share
  one builder (filter UI mirrors export semantics). `EXPORT_MAX_ROWS =
  100_000`. Response headers: `content-type`, `content-disposition`,
  `x-total-rows`, `x-exported-rows`, `x-truncated`. CSV trailer line
  `# truncated; N rows match, exported M` when result hits the cap. 10
  integration tests in `tests/integration/admin-audit-export.test.ts`.
- **M14.2 — Admin list pagination** (`7e3015c`). `listUsers({role?,
  status?, skip, take})`, `listApiKeys({status?, skip, take})`,
  `listAllTokens({skip, take})` all return `{rows, total}` via
  `Promise.all([findMany, count])`. New `<AdminPagination>` component
  preserves all non-pagination query params via `extraSearch` so role/
  status filters survive click-through. `PAGE_SIZE_DEFAULT=25`,
  `PAGE_SIZE_MAX=200`, NaN-safe parsing. github-tokens page does a
  secondary `listAllTokens({skip:0, take:PAGE_SIZE_MAX})` for quota
  totals to avoid page-flap. 8 integration tests + 8 unit tests.
- **M14.3 — Public API rate-limit visualization** (`ad01cd5`). Two
  pieces on `/docs` landing: (a) static three-tier explainer cards
  sourced from `env.PUBLIC_LOOKUP_RATE_PER_MIN` (default 30) +
  `apiKey.rateLimitPerMin` (Prisma default 60); documents 429 headers
  `Retry-After + X-RateLimit-Limit + X-RateLimit-Remaining`. (b) live
  status widget — SSR snapshot of `/api/v1/status` via shared
  `collectV1Status()` helper rendered as 7 compact field badges, each
  linking to raw JSON. Refactors: `/api/v1/status` becomes a thin
  wrapper around `collectV1Status()`; `/api/v1/repos/[owner]/[name]`
  switches from raw `incrementIpBucket` to `checkIpRateLimit()` so
  the 429 response carries X-RateLimit-* headers (truthful docs).
  9 new tests + 1 augmented route test.
- **M14.4 — Pool auto-rotation on consecutive 429s** (`b1b6750`). New
  `env.TOKEN_AUTO_DISABLE_THRESHOLD` (default 3, set 0 to disable).
  `recordUsage` distinguishes 429 (remaining=0 + resetAt in future)
  from success; per-token counter resets on this token's success.
  Threshold hit → `disableTokenById(id, 'auto-rotation')` +
  `pool.delete(id)` + warn-log. Audit log entry
  (`action: 'auto_disable_token'`, reason `auto-rotation`) emitted
  fire-and-forget. `'auto_disable_token'` added to the admin audit
  filter dropdown.

### Changed

- **M14.5 — Dependency upgrade sweep** (`6dab1f5`). Minor/patch bumps:
  `zod` 4.4.3→4.5.2, `next-intl` 4.14.0→4.14.1, `eslint-config-next`
  16.3.1→16.3.3. Focused major: `vitest` 1.6.1→4.1.11 +
  `@vitest/coverage-v8` 1.6.1→4.1.11. Vitest 4 / Vite 6 migration
  fixes: `__dirname`→`import.meta.dirname`; added `oxc: { jsx: 'automatic' }`
  (oxc is now default transformer; tsconfig's `jsx: 'preserve'` for
  Next.js breaks vite import-analysis); the `--reporter=basic` flag was
  removed (use `default` or `verbose`).

### Fixed

- **M14.x.9 — Collateral cleanup** (`7ba4a0d`). Three classes of
  M14.1+M14.2 collateral that surfaced as test failures in the full
  suite:
  - **SSR bug in `audit-filters.tsx`** — `exportHref()` used
    `window.location.origin`. The component is `'use client'` but
    renders server-side first; `window` was undefined and the page
    would 500 in SSR (no production visitor would see the export
    buttons). Fix: return path-only URL. The browser resolves the
    relative ref against the current origin.
  - **`api-docs-routes.test.ts` flat-key fix** — committed the flat
    `'columns.name'` form from M14.1. The nested `columns: { name, in,
    type, required, description }` form doesn't match next-intl 4
    strict-namespace lookup `t('columns.name')`.
  - **M14.2 page-helper mock drift** — `tests/unit/pool.test.ts` +
    `admin-api-keys-i18n.test.tsx` + `admin-users-i18n.test.tsx` still
    mocked `listUsers/listApiKeys/listAllTokens` to return bare arrays
    instead of `{rows, total}`. Updated all four.
- **M14.5 — 4 pre-existing lint issues surfaced as errors** under
  stricter `eslint-config-next` 16.3.3 (fixed in same commit):
  - 10× `react/no-unescaped-entities` in `how-it-works.tsx` — wrap JSX
    text with `{}` template strings.
  - `react-hooks/set-state-in-effect` in `command-palette.tsx` —
    combine setStates in `onChange` handler (no effect needed).
  - `react-hooks/purity` `Date.now()` in `admin/page.tsx` — extract to
    `loadDashboardBuckets()` helper in `src/lib/admin/dashboard-buckets.ts`
    (same pattern as M13.x.7's status-loader).
  - Unused `createElement` import in `admin-shell-i18n.test.ts`.

### Stats

- 6 commits (`3e45cac` → `6dab1f5`), ~30 files modified, 2 new files
  (`src/lib/admin/dashboard-buckets.ts`, `src/lib/api-docs/v1-status.ts`).
- 36 new tests in M14.1 + M14.2 + M14.3; +9 new M14.4 auto-disable
  tests; vitest 1→4 migration validated across the existing 385 unit
  tests + integration spot-checks (login-route, public-lookup-action,
  admin-audit-export, admin-pagination).
- 385/385 unit tests pass on vitest 4. ESLint clean except 7 pre-existing
  warnings (unrelated to the M14 round).

## [m14.x follow-up: M14.6 webhook delivery] — 2026-08-29

**Operator-facing webhook subscriptions.** System audit events fan out to
subscriber URLs signed with HMAC-SHA256 (`X-Hub-Signature-256` header,
GitHub-compatible). Exponential backoff retries (1m / 5m / 30m / 2h, max
5 attempts); auto-disable subscription on permanent 4xx or max retries.

### Added

- `WebhookSubscription` + `WebhookDelivery` models + `WebhookDeliveryStatus`
  enum (`pending` / `delivered` / `failed` / `dead`). Migration
  `20260829090000_m14_webhook_subscriptions` creates both tables with
  indices on `(status, nextRetryAt)` and `(subscription_id, created_at)`.
- Raw secret stored as `CHAR(64)` (lowercase hex of 32 random bytes).
  HMAC signing needs the raw bytes — hashing the secret breaks signing.
  Migration `20260829090500_m14_webhook_rename_secret` renamed
  `secret_hash` → `secret` after the design review caught the issue.
- `src/lib/webhooks/signer.ts` — `generateWebhookSecret()`,
  `signWebhookPayload()` (`sha256=<hex>`), `constantTimeEqual()`.
- `src/lib/webhooks/retry.ts` — `MAX_ATTEMPTS=5`,
  `BACKOFF_MS = [60s, 5m, 30m, 2h]`, `nextRetryMs(attemptCount)`,
  `shouldDeadLetter(attemptCount)`.
- `src/lib/webhooks/db.ts` — subscription CRUD, filter matching, delivery
  enqueue, due-delivery claim (`claimDueDeliveries`), terminal state
  transitions, findMatchingSubscriptions for fan-out, recordDeliveryResult
  to stamp `lastDeliveryAt` + `lastDeliveryStatus` on the parent.
- `src/lib/webhooks/worker.ts` — `attemptDelivery` (POST with 10s
  AbortController timeout), `processOneDelivery` (4xx except 408/429
  dead-letters immediately and auto-disables the sub), `runWorkerTick`
  (claim batch + process serially + summary).
- Fire-and-forget fan-out in `src/lib/audit/writer.ts` — every audit row
  triggers `fanOutAuditEvent` via dynamic import + Promise.allSettled. Hot
  path stays fast; failures don't poison sibling subscriptions.
- Webhook worker wired into `src/lib/scheduler/index.ts` (third interval,
  default 15s tick, 25 deliveries per tick).
- New env vars: `WEBHOOK_WORKER_TICK_MS` (default 15000) and
  `WEBHOOK_WORKER_BATCH_SIZE` (default 25).
- Admin UI: `/admin/webhooks` (list + create + per-row disable/re-arm/
  rotate-secret) and `/admin/webhooks/[id]` (detail with subscription
  metadata + recent deliveries + per-row retry for dead/failed rows).
  Full `admin.webhooks` namespace added to `messages/en.json` + `messages/zh.json`.
- 5 admin API routes: `POST /api/admin/webhooks` (create), `.../[id]/disable`,
  `.../[id]/re-arm`, `.../[id]/rotate-secret`, `.../deliveries/[id]/retry`.
  All admin-only (404 hide / 403 non-admin / 403 disabled).

### Tests

- 38 new unit tests across 4 files: `signer.test.ts` (8 — secret shape,
  signature equality, constant-time compare), `retry.test.ts` (12 — backoff
  math, dead-letter threshold), `matches-filter.test.ts` (6 — wildcard,
  fail-closed on non-array / non-string / empty), `webhook-worker.test.ts`
  (13 — 2xx/4xx/5xx/timeout, transient vs permanent errors, dead-letter on
  max attempts, deleted subscription handling, inactive subscription
  skipping). Total: 423/423 unit tests pass on vitest 4. Pre-existing
  integration flakes (api-query-stale, api-v1-repos-route) unchanged.

---

## [m15-apidocs] — 2026-08-29

**Unified error envelope + request-id stamping + machine-readable API
spec.** Every 4xx/5xx JSON response now carries a machine-readable `code`
plus a `requestId` that round-trips through the response header, and
external integrators can pull `/api-docs.json` for a flat JSON dump of
the public surface. The `/docs` page gained a "How caching works"
explainer section and an "Error codes" reference table.

### Added

- **`src/lib/api/errors.ts`** — unified error envelope
  `{error, code, requestId, details?}` additive over the legacy `error`
  field. `ErrorCode` union of 8 codes (`bad_request`, `unauthorized`,
  `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal_error`,
  `unavailable`) with `ERROR_CODE_STATUS` map (single source of truth
  for status codes). `apiError(code, message, opts, req?)` helper. Wire
  contract is fully backward compatible — old clients reading `error`
  keep working.
- **`src/lib/api/request-id.ts`** — `applyRequestId(req, res)` stamps
  `x-request-id` on every response (echo inbound if valid, else fresh
  UUID via Web Crypto). Edge-runtime safe. `readRequestId(req)` for
  log-only access. `sanitizeRequestId` enforces ≤128 chars + no control
  chars (prevents header injection / log poisoning).
- **Middleware request-id stamping** — `src/middleware.ts` now runs on
  every non-static route and stamps `x-request-id` on all responses
  (success, redirect, CSRF failure, default pass-through). Matcher
  changed to global pattern (Next.js negative lookahead; no capturing
  groups).
- **`GET /api-docs.json`** — flat JSON dump of every public endpoint
  (path, method, summary, auth, rate limit, cache semantics, request
  params, response samples, headers, errors with `code`). Top-level
  `caching` block exposes scheduler_tick_ms / nightly_sweep_ms /
  default_freshness_window_seconds / stale_path_on_github_down.
  `Cache-Control: public, max-age=300, stale-while-revalidate=600`. Built
  as `force-static` with `revalidate=300`.
- **`CacheDoc` shape** on every endpoint:
  `{ mode: 'cache-only' | 'cache-first' | 'passthrough',
     freshness_window_seconds?: number,
     stale_path?: 'serve' | 'fail' }`. Cache-first endpoints expose the
  freshness window; passthrough (e.g. `/api/v1/status`) omits it.
- **`/docs` page upgrades** — three new sections pre-awaited into the
  landing page:
  - "Download API spec" card (link + copy-cURL button) → `/api-docs.json`
  - "How caching works" explainer (5-step ordered list: client hit →
    cache check → on-miss queue + sync wait → scheduler drain → stale
    fallback when GitHub unreachable)
  - "Error codes" reference table — all 8 codes with status, retry hint
    (`no` / `after {seconds}s` / `later`), and per-code description
- **`apiError` swept across all 20 API routes** — `NextResponse.json({error}, {status})`
  replaced with `apiError(code, message)`. Hide-existence 404 patterns
  preserved (intentionally not converted to error envelope). Auth/login
  429s preserve their `Retry-After` header via `opts.headers`.
- **i18n parity** — `docs.landing.{downloadSpec, howCachingWorks, errorCodes}`
  namespaces added to `messages/en.json` + `messages/zh.json` (5 / 5 / 24
  keys respectively).
- **CSS** — `.ghc-doc-download-card`, `.ghc-doc-download-actions`,
  `.ghc-doc-cache-steps`, `.ghc-doc-cache-step-num` for the new sections.

### Tests

- **33 new unit tests** across 3 files:
  - `tests/unit/api-errors.test.ts` (18) — `apiError` envelope shape,
    status mapping, header echo + override, structured details, omitted
    `details` key, `apiErrorBody` helper, `sanitizeRequestId` (length /
    control chars / nullish), `generateRequestId` (UUID v4 shape +
    uniqueness), `statusToErrorCode` (forward + reverse).
  - `tests/unit/api-request-id.test.ts` (7) — `applyRequestId` (fresh /
    echo / invalid / chainability), `readRequestId` (echo / fallback),
    stability under repeated calls.
  - `tests/unit/api-docs-json.test.ts` (8) — envelope shape, cache-control
    header, server-wide `caching` block, endpoint enumeration, contract
    fields without zod schema leak, `cache-first` vs `passthrough` shape
    distinction, `code` on every error entry.
- 21 mock-key entries added to `docs-i18n.test.tsx` for the new
  translation namespaces.
- `tests/integration/middleware.test.ts` mock updated to provide
  `headers: noopHeaders` on the synthetic redirect / json response shapes
  (the middleware's request-id stamping requires it).
- Total: **731/732 tests pass on vitest 4 + 5**. Pre-existing
  integration flake `api-query-stale.test.ts > NotFoundError does NOT
  trigger stale path` unchanged (unrelated to M15).

### Constraints respected

- **No OpenAPI 3.1 conformance** — JSON dump is lightweight per user
  direction. No yaml, no spec validator, no zod→JSON Schema converter.
- **Backward compatible** — `error` field preserved on every error
  response; only `code` + `requestId` are added.
- **Edge-runtime safe** — UUID via `crypto.randomUUID()`; no Node APIs
  in middleware or errors helper.

---

## [m16-queries-ingestion] — 2026-08-31

**Two new admin views: query drill-down + ingestion pipeline health.**

Adds an operator-facing surface for the two flows M7's reports page only
glimpsed: who is hitting the consumer API (and what), and what is the
GitHub→DB pipeline doing right now.

### Added

- `/admin/queries` page — drill-down on consumer API traffic.
  - 4 KPI cards (total / hit rate / avg latency / active keys).
  - URL-driven date range picker (`?from=YYYY-MM-DD&to=YYYY-MM-DD`).
    `<input type="date">` × 2, inclusive end-of-day.
  - Two top-10 tables side-by-side (top repos, top API keys).
  - Paginated "recent requests" table at the bottom (50/page, prev/next).
    Anonymous v1 rows render as "anonymous" in the Key column.
  - Visible to **admin + operator** (matches /admin/reports).
- `/admin/ingestion` page — GitHub→DB pipeline health.
  - Scheduler state card (RUNNING/PAUSED + pausedAt + "Manage scheduler →"
    link to /admin/refresh).
  - 4 KPI cards: pending (current), in-progress (current), done (1h),
    failed (1h).
  - Fetch-status distribution bar for cached repos
    (ok / not_found / forbidden / error).
  - Paginated "recent refresh jobs" table joined with parent repo
    owner/name (50/page).
  - **Admin-only** — operators act on these signals via /admin/refresh.
- `recentRequests({skip, take}, {from, to})` in `src/lib/reports/queries.ts` —
  joins RequestLog with ApiKey for label resolution. Falls back to
  `(deleted)` when the parent ApiKey has been removed.
- `src/lib/reports/ingestion.ts` (new) — three aggregation helpers:
  - `ingestionSummary(from, to)` — pending + in-progress queue depths
    (current, not bound to window) plus done/failed counts.
  - `repositoryFetchBreakdown()` — counts of repos in each terminal
    `fetch_status` today.
  - `recentRefreshJobs({skip, take}, filters?)` — paginated RefreshJob
    rows joined with parent Repository (owner/name).
- Sidebar: 2 new entries (`Queries` admin+operator; `Ingestion` admin-only),
  slotted between `Reports` and `Audit`. Icons: `⊰` / `⊱`.

### Changed

- `/api/v1/repos/[owner]/[name]` — now logs every response (200/404/429/503)
  to RequestLog via `recordRequest()`. Anonymous (apiKeyId=null),
  endpoint=`/api/v1/repos/[owner]/[name]`, repoRequested=`owner/name`,
  cacheHit=true on 200 only. This lets the new /admin/queries page show
  v1 traffic alongside the authenticated /api/query traffic.
- `/admin/reports` kept as the top-level summary (KPI + 24h chart + quota).
  `/admin/queries` is its drill-down (date range + recent requests table).
  Decision per user direction — no removal.

### Stats

- ~10 files modified, 6 new files
  - new: `src/lib/reports/ingestion.ts`
  - new: `src/app/admin/queries/page.tsx` + 5 components
  - new: `src/app/admin/ingestion/page.tsx` + 4 components
  - new: `tests/unit/reports-recent-requests.test.ts`
  - new: `tests/unit/reports-ingestion.test.ts`
  - new: `tests/unit/admin-queries-i18n.test.tsx`
  - new: `tests/unit/admin-ingestion-i18n.test.tsx`
- 6 new DB-backed unit tests + 6 new i18n page tests = 12 new tests
- typecheck ✓, lint ✓ (0 errors), next build ✓

### Not done (YAGNI, deferred)

- p50/p95/p99 latency helpers — only `avgLatency()` is computed today.
- Scheduler-tick history table — tick stats still go to logs only.
- Per-key `topRepos` drill-down — only global `topRepos` is exposed.
- `RequestLog.batchSize` column — multi-node batches still only record
  the first node's `repoRequested`.

---

## [m17-database-backup] — 2026-08-31

**`/admin/database` — backup / restore (blue-green) + DB overview + tables + slow queries + Prisma Studio link.**
Self-service DB management page for backup-before-migration. Six sections on a
single admin-only page; backup files live in `./backups/` (browsable, downloadable,
retained per `BACKUP_KEEP_N`). Restore uses shadow-schema + atomic `RENAME TABLE`
swap with an automatic pre-restore snapshot as the rollback safety net. Startup
binary probe checks for `mysqldump` + `gzip`; if either is missing the admin page
shows a yellow banner but the server still boots.

### Added

**Env**
- `BACKUP_KEEP_N` (default `10`) — number of local backup files to retain. Older
  backups are trimmed by mtime after every successful backup.
- `BACKUP_DIR` (default `./backups`) — directory for backup files. Resolved
  relative to the server CWD.

**Binary check**
- `src/lib/database/binary-check.ts` — `checkBinaries()` (cache-backed probe via
  `execFile('bin', ['--version'])` for `mysqldump` and `gzip`), `getBinaryStatus()`,
  `binariesReady()`.
- `src/lib/database/startup.ts` — `startupDatabaseChecks()` runs at server boot
  (after `initPool`, before `startScheduler`). Logs warnings if either binary is
  missing; never fails boot.

**Backup**
- `src/lib/database/backup.ts` — `buildBackupFilename(now)` → `githubcache-YYYYMMDD-HHMMSS.sql.gz`.
  `createBackup(databaseUrl, filename?)` spawns `mysqldump --single-transaction --routines --triggers`
  piped through `gzip -6` to file. `MYSQL_PWD` env var preferred over `--password=` flag
  for invisible password passing. `listBackups()`, `getBackupPath(filename)` (rejects
  path traversal), `trimRetainN()` (sort by mtime, keep newest N), `backupDir()`.

**Restore (blue-green)**
- `src/lib/database/restore.ts` — `performRestore({source, actorUserId})`.
  Pre-restore auto-backup (always retained, bypasses trim) → `CREATE SCHEMA restore_shadow_{ts}`
  → `gzip -dc | mysql {shadow}` → verify table count + names match pre-restore set →
  loop `RENAME TABLE prod.T TO prod.T__rb_{ts}, shadow.T TO prod.T` → DROP rollback
  targets → DROP SHADOW. Failure mid-loop aborts; the pre-restore snapshot is the
  auto-rollback path.

**DB overview + tables + slow queries**
- `src/lib/database/overview.ts` — `getDatabaseOverview()` returns `version /
  databaseName / host / port / totalBytes / tableCount` from `information_schema`.
  `getTableStats()` joins Prisma `MODEL_TO_TABLE` mapping with row counts.
- `src/lib/database/tables.ts` — `getTableDetails()` returns per-table columns +
  indexes + `rowCount` + `bytes` from `information_schema.COLUMNS + STATISTICS + TABLES`.
- `src/lib/database/slow-queries.ts` — `topSlowQueries(limit)` reads from
  `performance_schema.events_statements_summary_by_digest` with graceful fallback
  `{kind: 'no_permission', reason}` when the DB user lacks the `PROCESS` privilege.

**Page + components**
- `src/app/admin/database/page.tsx` — server component, admin-only. Fetches 6 things
  in `Promise.all` (overview, tableStats, tableDetails, slow, backupsRaw, binaryStatus).
  Normalizes `mtime: Date` → ISO string for the client `RestoreSection`.
- `<BinaryWarning>` — yellow banner when binaries missing.
- `<Overview>` — async server component, KV grid.
- `<BackupSection>` — create / delete / download buttons + retention hint + success /
  error feedback.
- `<RestoreSection>` — two modes (existing backup / uploaded file). Confirm word
  `RESTORE` enables submit. Client-side `MAX_UPLOAD_BYTES` (500 MiB) guard.
- `<TablesSection>` — expandable rows showing columns + indexes (PK / NN badges).
- `<SlowQueriesSection>` — top N table with no-permission fallback banner.
- `<PrismaStudioLink>` — static instruction card pointing to `npx prisma studio`.

**API routes**
- `GET /api/admin/database/backup` — list backups + binary status.
- `POST /api/admin/database/backup` — CSRF-guarded, admin-only. Creates backup,
  audits as `database_backup`. Returns `{filename, size}`.
- `DELETE /api/admin/database/backup?id=<filename>` — admin-only. Audits as
  `database_backup_delete`.
- `GET /api/admin/database/backup/[id]/download` — streams `.sql.gz` as
  `application/gzip` with `Content-Disposition: attachment`. Path-traversal defense
  via `getBackupPath()`.
- `POST /api/admin/database/restore` — handles both `application/json` (`{csrf,
  mode:'backup', filename, confirm}`) and `multipart/form-data` (`{csrf, mode:'upload',
  confirm, file}`). Hard cap `MAX_UPLOAD_BYTES = 500 MiB`. Confirms word `RESTORE`.
  Audits success as `database_restore`, failure as `database_restore_failed`.

**Errors**
- `payload_too_large` (HTTP 413) added to `ERROR_CODES` in
  `src/lib/api/errors.ts` (raised by restore upload > 500 MiB).
- `payload_too_large: { retryNo: true }` added to `RETRY_HINTS` in
  `src/app/docs/_components/error-codes-table.tsx`.

**i18n**
- New namespace `admin.database.*` (title / description / breadcrumb / binaryWarning /
  overview / backup / restore / tables / slowQueries / prismaStudio) in both
  `messages/en.json` and `messages/zh.json`.
- Added missing `admin.shell.sections.{database, webhooks}` keys — the `webhooks`
  key was missing since M14.6 and silently broke the admin sidebar layout in
  production. Now fixed.

**Tests**
- `tests/unit/database-backup-helpers.test.ts` — 4 cases covering filename format
  invariants (zero-padding, chronological order, distinct timestamps).
- `tests/unit/admin-database-i18n.test.tsx` — 3 cases (title + description render,
  no binary-warning when binaries ready, all section stubs render together). Sync
  mocks of all 7 sub-components + page-level mocks for the 6 helpers.

### Side fix (unrelated to M17 spec)

`/admin/github-tokens` `poolHint` was crashing with `Functions cannot be passed
directly to Client Components` whenever the page was opened. The previous fix
attempted `t.rich('poolHint', { size: (chunks) => <strong>{chunks}</strong> })`,
which rendered but substituted the placeholder text (literal `size`), not the
runtime value (`activePoolSize`). Replaced with 4 plain `t()` fragments
(`poolHintPrefix`, `poolHintMid`, `poolHintEnv`, `poolHintSuffix`) + inline
`<strong>` / `<code>` JSX. See in-repo memory `feedback_next_intl_rich_dynamic_values`
— next-intl 4's `t.rich` callback `chunks` is the placeholder text only;
`<tag>{dynamicValue}</tag>` inside i18n strings must split into fragments.

### Migration

None. All changes are additive — new files + new env vars (both defaulted). No
Prisma schema changes.

### Stats

- 13 new files (`src/lib/database/{backup,restore,overview,tables,slow-queries,binary-check,startup}.ts`
  + 6 page components + API route files)
- 6 modified (env / errors / sidebar / error-codes-table / github-tokens page /
  en+zh messages)
- 7 new tests (4 helper + 3 page i18n)
- typecheck ✓ / lint ✓ (0 errors, 7 pre-existing warnings) / `next build` ✓
  (4 new routes: `/admin/database`, `/api/admin/database/backup`,
  `/api/admin/database/backup/[id]/download`, `/api/admin/database/restore`)

### Breaking changes

None. All M17 features are additive. Existing admin pages unchanged (except
the `poolHint` side fix and the silently-broken sidebar now correctly
rendering all 8 sections instead of 7).

### Security notes

- Backup download path traversal: `getBackupPath()` resolves the requested filename
  relative to the backup dir and verifies the result still lives inside it.
- `MYSQL_PWD` env var preferred over `--password=` flag — password does not show
  up in `ps` listings during the spawn window.
- Restore is destructive (overwrites live DB) — the RESTORE confirmation word
  is required; auto-pre-restore snapshot is always taken first.

---

## [m18-insights-reports] — 2026-08-31

**`/admin/insights` — multi-page reports over the cached `repositories` metadata.**
Admin-only landing page plus four drill-down reports covering popularity
ranking, language distribution, stale cache, and fetch health. Snapshot-only
(no history table) — every helper reads current state of the `repositories`
table directly via raw SQL with `JSON_EXTRACT` for metadata field access.

### Pages

| Route | Purpose |
|---|---|
| `/admin/insights` | Hub: 4 KPI cards (cached repos / OK share / language count / stale count) + 4 nav cards |
| `/admin/insights/top-repos` | Paginated, sortable (stars / forks / watchers / updated / last fetched), language-filterable listing of cached repos |
| `/admin/insights/languages` | Top 20 languages by repo count with share percentage (CSS flexbox bar list) |
| `/admin/insights/stale` | Repos not refreshed within N days (URL-driven threshold 1–365, default 7), oldest first |
| `/admin/insights/health` | fetch_status KPI strip (ok / 404 / 403 / error / total) + recent failures table |

### Added

**Helpers — `src/lib/reports/insights.ts`**
- `topRepos({skip, take, language?, sortBy})` — paginated, sortable, language-filterable.
  Sort + filter push down to MySQL via `JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.field'))`
  and `CAST(JSON_EXTRACT(...) AS UNSIGNED)` for numeric ordering.
- `languageDistribution(limit)` — top N languages by repo count among `fetch_status = 'ok'`
  rows with non-empty `metadata.language`. Excludes `''` empty-language rows.
- `distinctLanguages()` — sorted list of distinct language strings for the top-repos filter dropdown.
- `staleRepos({thresholdDays, skip, take})` — repos whose `last_fetched_at` is older
  than the threshold, oldest first. Includes pre-computed `ageDays`.
- `fetchStatusBreakdown()` — counts grouped by `fetch_status`. Mirrors M16's
  `repositoryFetchBreakdown` shape so the health page reuses the same KPI semantics.
- `recentFetchFailures({skip, take})` — non-OK repos, most-recently-fetched first.
- `isInsightsSortKey()` + `INSIGHTS_SORT_KEYS` — runtime guard for the sort URL param.

**Pages**
- `/admin/insights/page.tsx` — hub. Fetches breakdown + language list + stale count
  in parallel via `Promise.all`. Renders 4 KPI cards (`AdminKpiCard`) + 4 nav cards.
- `/admin/insights/top-repos/page.tsx` — server component. Reads `language / sort /
  limit / offset` from `searchParams` (URL-driven). Plain `<form method="get">`
  filter (no client JS). Filter preserves `sort` + `language` across pagination
  via `AdminPagination.extraSearch`.
- `/admin/insights/languages/page.tsx` — server component. Renders top 20 as a
  `.ghc-admin-bar-list` (CSS flexbox bar + inline width from `sharePct`).
- `/admin/insights/stale/page.tsx` — server component. Threshold input (1–365)
  with URL-driven GET form. Paginated by age.
- `/admin/insights/health/page.tsx` — server component. KPI strip with tone
  variants (positive when count > 0 for OK, negative for failures). Recent
  failures table joined from `Repository.findMany` with `fetchStatus: { in: [...] }`.

**Sidebar**
- New slug `insights` (icon `◬`, admin-only) added to `admin-sidebar.tsx`
  next to `database`. Routes to `/admin/insights`.

**i18n**
- New namespace `admin.insights.*` in both `messages/en.json` and `messages/zh.json`:
  title / description / breadcrumb / hub / topRepos / languages / stale / health.
  91 lines per file.
- New sidebar section key `admin.shell.sections.insights` (zh: "内容洞察", en: "Insights").

**CSS — `globals.css`**
- `.ghc-admin-kpi-grid` — auto-fit grid for KPI cards (min 180px).
- `.ghc-admin-card-grid` + `.ghc-admin-card*` — nav card grid with hover lift.
- `.ghc-admin-bar-list*` — language distribution bar list (label / bar / meta / share).
- `.ghc-admin-filter-input` + `.ghc-admin-filter-help` — number input + helper text.
- `.ghc-admin-empty` — empty-state paragraph.

**Tests**
- `tests/unit/reports-insights.test.ts` — 12 integration tests:
  - `isInsightsSortKey` accepts documented keys, rejects unknown.
  - `topRepos` default + `forks` ordering + language filter + status exclusion.
  - `languageDistribution` baseline-relative assertions + skip empty lang.
  - `distinctLanguages` contains seeded entries.
  - `staleRepos` threshold filter + NULL `last_fetched_at` exclusion.
  - `fetchStatusBreakdown` reports seeded counts.
  - `recentFetchFailures` excludes OK rows, orders by most-recent.

### Migration

None. Read-only over the existing `repositories` table.

### Stats

- 1 new helper file (`src/lib/reports/insights.ts`, ~280 lines)
- 5 new pages
- 1 sidebar entry + 1 sidebar section key
- 12 new integration tests
- typecheck ✓ / lint ✓ (0 errors) / `next build` ✓ (5 new routes built:
  `/admin/insights`, `/admin/insights/{health,languages,stale,top-repos}`)

### Breaking changes

None. All M18 features are additive. Sidebar grew by one entry.

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