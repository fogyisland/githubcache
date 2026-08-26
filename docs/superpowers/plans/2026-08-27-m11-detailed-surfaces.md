# M11 — Detailed Public + Admin Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform both the public site and admin app from bare-bones to fully-designed surfaces. Public gains 5 new sections + footer + detail-page API shape. Admin gains a real shell (sidebar + status bar + command palette + page header pattern), a shared component library, three switchable design directions, and full rewrites of all 7 pages.

**Architecture:** Public follows the M10 three-theme system (already in place). Admin gains a parallel three-variant system (`mission-control` / `inspector` / `workbench`) independent of the public theme — set via cookie `ghc_admin_variant` + DB `User.adminVariant`. All admin chrome renders through `<AdminShell data-admin="…">` which reads the cookie via `next/headers` and renders the variant-appropriate sidebar/status bar/header.

**Tech Stack:** Next.js 14 App Router · TypeScript strict · Tailwind v4 (`@theme inline`) · Prisma 5 + MySQL · zod · vitest · playwright (existing).

**Spec:** `docs/superpowers/specs/2026-08-27-m11-detailed-surfaces-design.md`

---

## Global Constraints

(Copy-verbatim from the spec; every task implicitly satisfies these.)

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- npm (NOT pnpm). `npm run dev:server` for local boot.
- MySQL 5.7.44. CI uses `mysql:5.7.44`. No `SKIP LOCKED`.
- bcrypt cost 12 for any new auth.
- Admin API routes use `cookiesFromRequest(req)` + `validateSession`, NOT `cookies()` from next/headers.
- Prisma UTC timestamps (`@db.DateTime(6)`).
- All theme + variant switching is via `[data-theme="X"]` and `[data-admin="Y"]` attributes on the root element; component classes read from CSS variables — one attribute change = full repaint.
- Audit dropdown in `src/app/admin/audit/_components/audit-filters.tsx` is hard-coded — every new audit action must be added there.
- MySQL local time zone quirk: use `UTC_TIMESTAMP(6)` in raw SQL.
- Component class naming: `ghc-*` for public surface, `ghc-admin-*` for admin (avoids accidental collision with public theme classes).
- No Docker — deploy is plain Node.js (per `feedback_no_docker`).
- Per memory `feedback_design_quality`: avoid the three AI-default looks (cream+serif+terracotta, near-black+acid-green, broadsheet hairline+columns). Each of the three admin variants takes one real aesthetic risk and owns it.

---

## Task Structure

Each task produces a self-contained, committable change. Tests written first per task.

---

### Task M11.1 — Foundation: variant registry + cookie + Prisma schema

**Files:**
- Modify: `prisma/schema.prisma` — add `AdminVariant` enum + `User.adminVariant` field.
- Create: `prisma/migrations/m11_admin_variant/migration.sql` — generated.
- Create: `src/lib/admin/variant.ts` — registry + `resolveAdminVariant` + `isAdminVariant`.
- Create: `src/lib/admin/cookie.ts` — `readAdminVariantFromCookieHeader` + `buildAdminVariantSetCookie`.
- Create: `tests/unit/admin-variant.test.ts`.

**Interfaces:**
- Exports: `ADMIN_VARIANT_IDS = ['mission_control','inspector','workbench'] as const`.
- Exports: `type AdminVariantId = (typeof ADMIN_VARIANT_IDS)[number]`.
- Exports: `DEFAULT_ADMIN_VARIANT: AdminVariantId = 'mission_control'`.
- Exports: `ADMIN_VARIANTS: Record<AdminVariantId, AdminVariantMeta>` with `{ id, label, shortLabel, blurb }`.
- Exports: `ADMIN_VARIANT_COOKIE = 'ghc_admin_variant'`.
- Exports: `function resolveAdminVariant(v: unknown): AdminVariantId`.
- Exports: `function readAdminVariantFromCookieHeader(header: string | null): AdminVariantId`.
- Exports: `function readAdminVariantFromRequest(req: Request): AdminVariantId`.
- Exports: `function buildAdminVariantSetCookie(id: AdminVariantId): string`.

**Steps:**

- [ ] **Step 1: Write failing test** — `tests/unit/admin-variant.test.ts` covering registry (3 variants), `isAdminVariant` accept/reject, `resolveAdminVariant` falls back to default for unknown, cookie read/write/roundtrip, `buildAdminVariantSetCookie` returns valid Set-Cookie with `Path=/` + `Max-Age=31536000` + `SameSite=Lax`.

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/unit/admin-variant.test.ts`. Expect FAIL (modules not found).

- [ ] **Step 3: Update Prisma schema** — add `enum AdminVariant { mission_control @map("mission_control") inspector workbench }`; add `adminVariant AdminVariant @default(mission_control) @map("admin_variant")` to `User` model.

- [ ] **Step 4: Generate migration** — `npx prisma migrate dev --name m11_admin_variant`. Verify SQL adds column + default.

- [ ] **Step 5: Implement registry** — `src/lib/admin/variant.ts`. Mirror M10 `src/lib/theme/themes.ts` shape (THEME_IDS, isThemeId, resolveTheme).

- [ ] **Step 6: Implement cookie helper** — `src/lib/admin/cookie.ts`. Mirror M10 `src/lib/theme/cookie.ts` shape (THEME_COOKIE, readFromCookieHeader, readFromRequest, buildSetCookie).

- [ ] **Step 7: Run test to verify it passes** — expect PASS (≥10 assertions).

- [ ] **Step 8: Commit** — `git add prisma/schema.prisma prisma/migrations tests/unit/admin-variant.test.ts src/lib/admin/ && git commit -m "feat(M11.1): admin variant registry + cookie + User.adminVariant column"`.

---

### Task M11.2 — Admin variant switcher (server action + client component)

**Files:**
- Create: `src/app/_actions/admin-variant.ts` — `setAdminVariantAction`.
- Create: `src/app/_components/admin-variant-switcher.tsx` — three pill buttons (M / I / W).
- Modify: `src/app/admin/layout.tsx` — embed switcher (deferred to M11.7 when shell lands; for now stash in `layout.tsx`).
- Modify: `tests/unit/admin-variant.test.ts` — add roundtrip test for action (mocked cookie/DB).

**Interfaces:**
- Action signature: `setAdminVariantAction(prev: SetAdminVariantState, formData: FormData) => Promise<SetAdminVariantState>`.
- `SetAdminVariantState = { status: 'idle' } | { status: 'ok'; variant: AdminVariantId } | { status: 'error'; message: string }`.
- Always sets cookie. If logged-in, also updates `users.adminVariant`.

**Steps:**

- [ ] **Step 1: Write failing test** — unit test the action with mocked `validateSession` + Prisma: anon sets cookie only, logged-in sets cookie + DB.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement action** — `src/app/_actions/admin-variant.ts`. zod-validate variant id; set cookie via `cookies()` (works inside server actions); if logged-in call `prisma.user.update({ where: { id: user.id }, data: { adminVariant: id } })`; `revalidatePath('/', 'layout')`.

- [ ] **Step 4: Implement switcher** — `src/app/_components/admin-variant-switcher.tsx`. Mirror `theme-switcher.tsx`: client component, three pills with `aria-pressed`, `useFormState` + `useFormStatus`.

- [ ] **Step 5: Embed in admin layout** — add `<AdminVariantSwitcher current={currentVariant} />` next to existing ThemeSwitcher.

- [ ] **Step 6: Run test to verify it passes** — expect PASS.

- [ ] **Step 7: Smoke test in browser** — `curl http://localhost:3000/admin` (with auth cookie from login), verify switcher renders 3 pills.

- [ ] **Step 8: Commit** — `git commit -m "feat(M11.2): admin variant switcher (server action + client pills)"`.

---

### Task M11.3 — Admin atoms: chip, empty state, page header, KPI card

**Files:**
- Create: `src/app/admin/_components/admin-status-chip.tsx`.
- Create: `src/app/admin/_components/admin-empty-state.tsx`.
- Create: `src/app/admin/_components/admin-page-header.tsx`.
- Create: `src/app/admin/_components/admin-kpi-card.tsx`.
- Create: `tests/unit/admin-status-chip.test.tsx` — renders all 5 variants.

**Interfaces:**
- `AdminStatusChip({ variant: 'ok'|'warn'|'danger'|'neutral'|'info', children })` — theme-aware colors via `--color-*` tokens.
- `AdminEmptyState({ icon: ReactNode, title, description?, action? })`.
- `AdminPageHeader({ breadcrumb: { label, href? }[], title, description?, actions?: ReactNode })`.
- `AdminKpiCard({ label, value, hint?, tone?: 'default'|'positive'|'negative' })` — replaces the gray-200 hardcoded one in reports.

**Steps:**

- [ ] **Step 1: Write failing tests** — one render test per component.

- [ ] **Step 2: Run tests to verify they fail** — expect FAIL.

- [ ] **Step 3: Implement AdminStatusChip** — `src/app/admin/_components/admin-status-chip.tsx`. Variants map to existing CSS tokens (`--color-success`, `--color-warn`, `--color-danger`, `--color-ink-muted`, `--color-accent`).

- [ ] **Step 4: Implement AdminEmptyState** — centered flex column, icon (28×28) + h3 + p + optional CTA button.

- [ ] **Step 5: Implement AdminPageHeader** — flex between breadcrumb (`/` separator) on left, title + actions on right. Uses theme tokens.

- [ ] **Step 6: Implement AdminKpiCard** — `ghc-admin-kpi` class. Theme-aware borders + bg.

- [ ] **Step 7: Add CSS for `ghc-admin-*`** — extend globals.css with `ghc-admin-kpi`, `ghc-admin-chip`, `ghc-admin-empty`, `ghc-admin-page-header` classes (theme-agnostic, read from variables).

- [ ] **Step 8: Run tests to verify they pass** — expect PASS.

- [ ] **Step 9: Commit** — `git commit -m "feat(M11.3): admin atom components (chip, empty state, page header, KPI card)"`.

---

### Task M11.4 — Admin table + filter bar

**Files:**
- Create: `src/app/admin/_components/admin-table.tsx` — generic table with header/rows/empty/loading/pagination.
- Create: `src/app/admin/_components/admin-filter-bar.tsx` — URL-synced filter UI.
- Create: `tests/unit/admin-table.test.tsx` — renders all states, empty row handling.

**Interfaces:**
- `AdminTable<T>({ columns: AdminColumn<T>[], rows: T[], emptyTitle?, emptyDescription?, isLoading?, pagination?: { total, limit, offset, basePath }, rowHref?: (row: T) => string })`.
- `AdminColumn<T> = { key, header, render: (row: T) => ReactNode, width?: string, align?: 'left'|'right' }`.
- `AdminFilterBar({ filters: { name, label, options: { value, label }[] }[], basePath })` — renders as form GETs to basePath, reads current values from `searchParams`.

**Steps:**

- [ ] **Step 1: Write failing tests** — render test for table (with rows + empty + loading), filter bar renders options and submits GET.

- [ ] **Step 2: Run tests to verify they fail** — expect FAIL.

- [ ] **Step 3: Implement AdminTable** — generic typed table component. Empty state renders AdminEmptyState. Loading state shows 5 skeleton rows. Pagination links preserve filters via querystring concat.

- [ ] **Step 4: Implement AdminFilterBar** — `<form method="get" action={basePath}>` with one `<select>` per filter. Auto-submits on change via `onChange={(e) => e.target.form?.submit()}`. Reads current values from `searchParams` prop (passed from page).

- [ ] **Step 5: Add CSS** — `ghc-admin-table`, `ghc-admin-table-row`, `ghc-admin-table-th`, `ghc-admin-table-td`, `ghc-admin-table-empty`, `ghc-admin-skeleton` classes.

- [ ] **Step 6: Run tests to verify they pass** — expect PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(M11.4): admin table + filter bar components"`.

---

### Task M11.5 — Confirm dialog + status bar + palette/status API routes

**Files:**
- Create: `src/app/admin/_components/admin-confirm-dialog.tsx` — destructive-action confirmation.
- Create: `src/app/admin/_components/admin-status-bar.tsx` — mission-control only, polls `/api/v1/admin/status`.
- Create: `src/app/api/v1/admin/status/route.ts` — returns `{ db, queue, scheduler, recentAuditCount, variant }`.
- Create: `src/app/api/v1/admin/palette/route.ts` — returns `{ sections: [{slug, title, icon, roles[]}], recentAudit: [{id, action, actor, createdAt}] }`.

**Interfaces:**
- `AdminConfirmDialog({ triggerLabel, title, description, confirmLabel, action })` — wraps a destructive server action.
- `AdminStatusBar({ initialData })` — polls every 10s, renders 4 columns.
- API responses are JSON, 200; auth-gated.

**Steps:**

- [ ] **Step 1: Write failing test** — `tests/unit/admin-status-bar.test.tsx` mocks fetch + renders 4 columns from initial data.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement confirm dialog** — uses native `<dialog>` + `<form method="dialog">` with action. No third-party modal lib.

- [ ] **Step 4: Implement status bar** — client component, `useEffect` setInterval polling. Renders DB ping (ms), queue depth, scheduler state (RUNNING/PAUSED), current user + variant.

- [ ] **Step 5: Implement status API** — `route.ts`. Uses `cookiesFromRequest` + `validateSession`. Queries DB for queue depth (RefreshJob.count by status), scheduler state (in-memory `isPaused()`), recent audit count.

- [ ] **Step 6: Implement palette API** — `route.ts`. Static section list + 5 most recent audit entries. Uses existing `queryAuditLog({ limit: 5 })`.

- [ ] **Step 7: Run test to verify it passes** — expect PASS.

- [ ] **Step 8: Commit** — `git commit -m "feat(M11.5): confirm dialog + status bar + admin status/palette API"`.

---

### Task M11.6 — Admin shell + sidebar + 3-variant CSS layer

**Files:**
- Create: `src/app/admin/_components/admin-shell.tsx` — wraps page children, decides variant chrome.
- Create: `src/app/admin/_components/admin-sidebar.tsx` — 7 sections, role-gated, current-section indicator.
- Modify: `src/app/globals.css` — add 3 `[data-admin="X"]` blocks + component classes.

**Interfaces:**
- `AdminShell({ current, variant, user, children })` — renders sidebar + main + status-bar-if-mission-control.
- Sidebar sections: dashboard / users / api-keys / github-tokens / reports / audit / refresh. Each has `{ slug, title, icon, roles: Role[] }`.
- `[data-admin="mission_control"]` — slate bg + amber accent + mono type.
- `[data-admin="inspector"]` — cream bg + ink + serif headings.
- `[data-admin="workbench"]` — white bg + electric blue + Space Grotesk.

**Steps:**

- [ ] **Step 1: Write failing test** — `tests/unit/admin-shell.test.tsx` renders children + sidebar with current-section indicator.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement admin shell** — flex layout. Sidebar fixed left (240px desktop, collapsible <1024px). Main padded. Status bar sticky bottom for mission-control only.

- [ ] **Step 4: Implement admin sidebar** — `<nav>` with `<Link>` per section. Current-section = left border accent. Role-gating via `user.role` prop.

- [ ] **Step 5: Add 3-variant CSS in globals.css** — define `--admin-bg`, `--admin-ink`, `--admin-accent`, `--admin-rule`, `--admin-mono`, `--admin-display` per variant. Each variant's component chrome reads from these.

- [ ] **Step 6: Run test to verify it passes** — expect PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(M11.6): admin shell + sidebar + 3-variant CSS layer"`.

---

### Task M11.7 — Command palette

**Files:**
- Create: `src/app/admin/_components/command-palette.tsx` — ⌘K modal, fuzzy search across sections + recent audit.

**Interfaces:**
- `CommandPalette()` — client component. Listens for ⌘K / Ctrl+K. Fetches `/api/v1/admin/palette` on open. Renders results grouped by "Sections" + "Recent audit".

**Steps:**

- [ ] **Step 1: Write failing test** — `tests/unit/command-palette.test.tsx` mocks fetch + keyboard event. Open via Ctrl+K, type "user", verify users section ranked first.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement command palette** — uses native `<dialog>`. Fuzzy match: simple `includes()` lowercase substring scoring. Arrow-key navigation. Enter to navigate. Esc to close.

- [ ] **Step 4: Add to admin shell** — render `<CommandPalette />` once at shell root.

- [ ] **Step 5: Run test to verify it passes** — expect PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(M11.7): command palette (⌘K fuzzy search)"`.

---

### Task M11.8 — Rewrite `admin/layout.tsx` to use AdminShell

**Files:**
- Modify: `src/app/admin/layout.tsx` — replace inline nav with `<AdminShell>` wrapper.

**Interfaces:**
- Admin layout reads cookies + DB session + admin variant + theme, passes to shell.

**Steps:**

- [ ] **Step 1: Smoke test pre-rewrite** — `curl http://localhost:3000/admin` (auth'd) returns 200 with existing nav.

- [ ] **Step 2: Rewrite layout** — auth check + redirect unchanged. Replace `<nav>` with `<AdminShell current={currentSection} variant={adminVariant} user={user}>{children}</AdminShell>`.

- [ ] **Step 3: Verify all admin pages still render** — `curl` each of /admin, /admin/users, /admin/api-keys, /admin/github-tokens, /admin/reports, /admin/audit, /admin/refresh. All return 200.

- [ ] **Step 4: Verify data-admin attribute on `<html>`** — `curl -s -H "Cookie: ghc_admin_variant=inspector" http://localhost:3000/admin | grep data-admin`. Should show `data-admin="inspector"`.

- [ ] **Step 5: Verify variant switcher works** — POST to action, GET page reflects new variant.

- [ ] **Step 6: Commit** — `git commit -m "refactor(M11.8): admin layout uses AdminShell (sidebar + status bar + palette)"`.

---

### Task M11.9 — Dashboard page rewrite

**Files:**
- Modify: `src/app/admin/page.tsx` — real dashboard with KPIs + small charts + recent activity.

**Steps:**

- [ ] **Step 1: Write failing test** — `tests/integration/admin-dashboard.test.ts` GETs /admin with valid session, asserts presence of KPI cards + recent activity feed.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement dashboard** — 4 KPIs (cached repos, active users, active keys, active tokens) from parallel queries + 1 small chart (requests over last 6h, 1h buckets) + recent activity feed (top 5 audit entries).

- [ ] **Step 4: Use AdminPageHeader + AdminKpiCard** — compose the new atoms. Theme-aware.

- [ ] **Step 5: Run integration test** — expect PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(M11.9): admin dashboard rewrite (KPIs + chart + recent activity)"`.

---

### Task M11.10 — Users + API Keys + GitHub Tokens list pages rewrite

**Files:**
- Modify: `src/app/admin/users/page.tsx`.
- Modify: `src/app/admin/api-keys/page.tsx`.
- Modify: `src/app/admin/github-tokens/page.tsx`.

**Steps:**

- [ ] **Step 1: Write failing integration tests** — one per page, asserts AdminTable + AdminPageHeader + AdminFilterBar render.

- [ ] **Step 2: Run tests to verify they fail** — expect FAIL.

- [ ] **Step 3: Rewrite Users page** — AdminPageHeader + AdminFilterBar (role/status) + AdminTable of users + invite form (existing) + pending invitations section.

- [ ] **Step 4: Rewrite API Keys page** — AdminPageHeader + AdminFilterBar (status) + AdminTable + status chips (active/revoked/pending).

- [ ] **Step 5: Rewrite GitHub Tokens page** — AdminPageHeader + add-token-form (existing) + AdminTable + quota warning + active-in-pool indicator chip.

- [ ] **Step 6: Run integration tests** — expect PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(M11.10): users + api-keys + github-tokens list pages use AdminShell components"`.

---

### Task M11.11 — Users + API Keys + GitHub Tokens detail pages rewrite

**Files:**
- Modify: `src/app/admin/users/[id]/page.tsx`.
- Modify: `src/app/admin/api-keys/[id]/page.tsx`.
- Create: `src/app/admin/github-tokens/[id]/page.tsx` — new drill-down.

**Steps:**

- [ ] **Step 1: Write failing integration tests** — each page returns 200 + renders profile section + recent audit trail summary.

- [ ] **Step 2: Run tests to verify they fail** — expect FAIL.

- [ ] **Step 3: Rewrite User detail** — AdminPageHeader + profile card (role/status/created/last-login/session count) + keys-owned section + recent audit trail + UserActions.

- [ ] **Step 4: Rewrite API Key detail** — AdminPageHeader + profile card + LimitsForm (existing) + KeyActions (existing) + last-24h-requests mini chart + recent audit trail.

- [ ] **Step 5: Create GitHub Token detail** — AdminPageHeader + profile card + quota usage mini chart + last-used history + recent audit trail + TokenActions.

- [ ] **Step 6: Run integration tests** — expect PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(M11.11): users + api-keys + github-tokens detail page rewrites + new token detail"`.

---

### Task M11.12 — Reports + Audit + Refresh page rewrites

**Files:**
- Modify: `src/app/admin/reports/page.tsx` — add date range picker + CSV export.
- Modify: `src/app/admin/audit/page.tsx` — add diff view + CSV export + filter persistence.
- Modify: `src/app/admin/refresh/page.tsx` — emphasize scheduler state.

**Steps:**

- [ ] **Step 1: Write failing integration tests** — each page returns 200 + new feature renders.

- [ ] **Step 2: Run tests to verify they fail** — expect FAIL.

- [ ] **Step 3: Rewrite Reports page** — AdminPageHeader + date range picker (1h/24h/7d/custom, URL-synced) + CSV export link (`/api/v1/admin/reports.csv?...`) + existing 5 widgets.

- [ ] **Step 4: Rewrite Audit page** — AdminPageHeader + AuditFilters (existing, extended for diff view) + AuditTable + diff expand row + CSV export + persistent filters in pagination links.

- [ ] **Step 5: Rewrite Refresh page** — AdminPageHeader + scheduler state prominent (RUNNING/PAUSED, pausedAt) + RefreshControls (existing) + PendingJobsTable (existing) + queue depth counter.

- [ ] **Step 6: Add CSV export endpoints** — `/api/v1/admin/reports.csv` + `/api/v1/admin/audit.csv`. Returns `text/csv` with `Content-Disposition: attachment`.

- [ ] **Step 7: Run integration tests** — expect PASS.

- [ ] **Step 8: Commit** — `git commit -m "feat(M11.12): reports + audit + refresh rewrites with date picker / diff / CSV export"`.

---

### Task M11.13 — Public site depth sections (stats bar + features + how-it-works)

**Files:**
- Create: `src/app/_components/stats-bar.tsx` — 4 numbers from `/api/v1/status`.
- Create: `src/app/_components/features-section.tsx` — 3-up grid.
- Create: `src/app/_components/how-it-works.tsx` — 3 numbered steps with inline SVGs.
- Modify: `src/app/page.tsx` — insert new sections between hero and form.

**Steps:**

- [ ] **Step 1: Write failing integration test** — `tests/integration/public-home.test.ts` GETs /, asserts presence of stats-bar + features-section + how-it-works.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement StatsBar** — client component, fetches `/api/v1/status`, displays 4 numbers. Numbers animate from 0 on first paint via `requestAnimationFrame`.

- [ ] **Step 4: Implement FeaturesSection** — 3-up grid (Instant / Cached / Rate-limited + API). Each has SVG icon + headline + 1-line demo + theme tokens.

- [ ] **Step 5: Implement HowItWorks** — 3 numbered steps (01 / 02 / 03), each with inline SVG diagram (server / cache / response). Theme-aware.

- [ ] **Step 6: Update home page** — insert 3 new sections in order: hero → stats-bar → features → how-it-works → form → recent lookups → footer.

- [ ] **Step 7: Run integration test** — expect PASS.

- [ ] **Step 8: Commit** — `git commit -m "feat(M11.13): public site stats bar + features + how-it-works sections"`.

---

### Task M11.14 — Public site: API doc + quick try + footer + site-header demote

**Files:**
- Create: `src/app/_components/api-doc-section.tsx` — curl + response shape.
- Create: `src/app/_components/quick-try.tsx` — 3 example repo buttons.
- Create: `src/app/_components/site-footer.tsx` — version, source, status, admin.
- Modify: `src/app/_components/site-header.tsx` — demote Status / Admin to ghost links.
- Modify: `src/app/page.tsx` — insert new sections.

**Steps:**

- [ ] **Step 1: Write failing integration test** — GETs /, asserts presence of api-doc + quick-try + footer.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement ApiDocSection** — `ghc-code-block` for curl example + truncated JSON response shape. Theme-aware.

- [ ] **Step 4: Implement QuickTry** — 3 server-action buttons (torvalds/linux, microsoft/vscode, vitejs/vite), each calls existing lookupAction with prefilled owner/name.

- [ ] **Step 5: Implement SiteFooter** — 3 columns: brand + tagline / version + source / status + admin. Reads version from `package.json` (build-time).

- [ ] **Step 6: Demote site-header links** — change `<Link className="ghc-btn-ghost">` to lower-prominence ghost style (smaller, muted).

- [ ] **Step 7: Update home page** — insert new sections: api-doc after how-it-works, quick-try after form, footer at end (replace existing footer).

- [ ] **Step 8: Run integration test** — expect PASS.

- [ ] **Step 9: Commit** — `git commit -m "feat(M11.14): public site API doc + quick try + footer + header demote"`.

---

### Task M11.15 — Public site detail: API shape collapsible + verify + CHANGELOG + tag

**Files:**
- Create: `src/app/repo/[owner]/[name]/_components/api-shape.tsx` — collapsible JSON dump.
- Modify: `src/app/repo/[owner]/[name]/page.tsx` — embed API shape section.
- Modify: `CHANGELOG.md` — add M11 entry.
- Create: tag `m11-detailed-surfaces`.

**Steps:**

- [ ] **Step 1: Write failing integration test** — GETs /repo/torvalds/linux, asserts `<details>` with API shape present.

- [ ] **Step 2: Run test to verify it fails** — expect FAIL.

- [ ] **Step 3: Implement ApiShape** — `<details><pre><code>{JSON.stringify(metadata, null, 2)}</code></pre></details>`. Theme-aware via `ghc-code-block`.

- [ ] **Step 4: Embed in detail page** — add API shape section below Activity card.

- [ ] **Step 5: Run integration test** — expect PASS.

- [ ] **Step 6: Final verification** — `npm run lint && npm run typecheck && npm test && npx prisma migrate deploy`. All clean. Browser smoke: log in, switch admin variant, ⌘K, visit each admin page, switch public theme.

- [ ] **Step 7: Update CHANGELOG.md** — add M11 entry mirroring M10's structure: scope, additions table, env, migration, stats, breaking changes.

- [ ] **Step 8: Commit** — `git commit -m "feat(M11.15): public detail page API shape + CHANGELOG + tag m11-detailed-surfaces"`.

- [ ] **Step 9: Tag** — `git tag m11-detailed-surfaces`.

---

## Stats

- 15 tasks (M11.1 → M11.15)
- ~30 new files, ~15 modified
- ~2000-2500 lines of code (CSS heavy)
- ~50+ new tests (unit + integration)
- 3 admin design directions + 3 public themes = 9 visual variants (testable per-variant under terminal theme — visual regression)
- Tag: `m11-detailed-surfaces`

---

## Self-review

- [x] Spec coverage — every section in the spec (4.1 public, 4.2 admin variants, 4.3 shell, 4.4 components, 4.5 data flow, 5 data model, 6 API, 7 file structure, 8 testing) maps to tasks.
- [x] No placeholders — every step has concrete files + actions.
- [x] Type consistency — `AdminVariantId` used consistently across tasks 1, 2, 6, 8.
- [x] Dependency order — Tasks 1-8 build foundation (variant + components + shell), 9-12 rewrite pages, 13-14 build public depth, 15 wraps. No task depends on a later task.
- [x] Global constraints — TypeScript strict, npm, MySQL 5.7.44, cookiesFromRequest, UTC timestamps, `ghc-admin-*` naming, no Docker, no AI-default looks — all addressed.