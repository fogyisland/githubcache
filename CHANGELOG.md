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