# M28 — /admin/database Redesign

**Status:** Draft (brainstorming approved, awaiting user spec review)
**Date:** 2026-09-07
**Owner:** M28 task
**Spec type:** Architectural (UI redesign, new information architecture)

---

## 1. Background

`/admin/database` is the single page operators use to inspect DB health,
take backups, restore from a backup, browse table schemas, and view slow
queries. It was shipped in M17 as one page with seven stacked sections:
binary-warning → overview → backup → restore → tables → slow-queries →
prisma-studio-link.

The user reports the page has four concrete problems:

1. **Dangerous operations have insufficient warning** — Restore is a
   DROP+REPLACE of the entire DB. The current UI surfaces this only via
   an inline `<p className="ghc-admin-warn-inline">` plus a `confirm ===
   'RESTORE'` text input. The whole section sits in the same flow as
   benign backups; nothing visually isolates the destructive path.
2. **Operation flow is unclear** — seven sections in vertical sequence
   with no grouping. A first-time admin can't tell at a glance which
   section is the dangerous one or how Restore is gated.
3. **Information density too high / visual clutter** — the Tables list
   renders every table's columns + indexes inline if expanded; the
   Slow Queries section has no sort or filter; the Overview section
   shows only five static values with no activity signal.
4. **Missing key operational metrics** — Overview only reports
   `version`, `host`, `port`, `tableCount`, `totalBytes`. Operators
   looking at the page during a routine check see nothing about:
   when the last backup was taken, how stale it is, DB uptime,
   active connections, or recent error rates.

The page is also admin-only — it never appears in the public or
operator paths.

## 2. Goal

Redesign `/admin/database` so that:

- A routine 30-second inspection of DB health surfaces everything the
  operator needs without scrolling.
- The destructive Restore path is visually isolated, requires two
  independent confirmations, and includes an automatic pre-restore
  safety net that is visible *before* the user reaches the input.
- The Tables list is sortable + filterable; rows default to collapsed
  detail to reduce visual noise.
- The Slow Queries table is sortable by any column.
- The Overview section shows four new operational signals:
  - **Last backup age** (time since the most recent backup file, in
    hours/days, with a chip that turns amber when > 24h and red when
    > 7d)
  - **DB uptime** (from `SHOW STATUS LIKE 'Uptime'`)
  - **Active connections** (current / max, from
    `SHOW STATUS LIKE 'Threads_connected'` + `SHOW VARIABLES LIKE
    'max_connections'`)
  - **Cache hit rate** (from `SHOW STATUS LIKE 'Innodb_buffer_pool_hit_ratio'`
    or derived from `Innodb_buffer_pool_reads` vs
    `Innodb_buffer_pool_read_requests`)

The visual language must remain consistent with the existing admin
shell's `mission_control` variant (terminal-style, dense, dark). No new
admin variant is introduced.

## 3. Information architecture — five tabs on one route

The page retains the single URL `/admin/database`. A horizontal tab
bar at the top of the content area jumps to in-page sections via URL
hash (`#overview`, `#backup`, `#restore`, `#tables`, `#queries`,
`#studio`). The hash-driven jump lets operators deep-link to a section
(`/admin/database#restore` for incident response) while keeping the
single-route, single-i18n-namespace structure.

Tabs left-to-right, in this order:

| # | Tab       | Section purpose                                                                | Primary user           |
|---|-----------|--------------------------------------------------------------------------------|----------------------|
| 1 | Overview  | Health summary — KPI grid + activity signals                                   | Routine check         |
| 2 | Backup    | Non-destructive path: list backups, create new, download, delete                | Routine check        |
| 3 | Restore   | Destructive path: pick source (existing backup or upload), confirm twice       | Incident response    |
| 4 | Tables    | Browse schemas — sortable + filterable, columns/indexes on expand               | Schema inspection    |
| 5 | Queries   | Slow query log — sortable, with table-name filter                              | Performance tuning   |
| 6 | Studio    | Prisma Studio launch link + command snippet                                     | Quick reference       |

The tab bar uses the existing `AdminFilterBar` atom (or a sibling
`AdminTabs` atom — see §6.2). It is sticky at the top of the content
area so a long Restore session doesn't lose context.

## 4. Section-by-section design

### 4.1 Overview

Replaces the current five-field `<dl className="ghc-admin-kv-grid">`.
Becomes a 7-cell KPI grid using `AdminKpiCard`:

| KPI                | Source                                           | Format                                |
|--------------------|--------------------------------------------------|---------------------------------------|
| Version            | `SELECT VERSION()`                               | `8.0.36`                              |
| Uptime             | `SHOW STATUS LIKE 'Uptime'`                      | `Xd Yh`                               |
| Host:port          | `DATABASE_URL` (parsed)                          | `localhost:3306`                      |
| Database           | `DATABASE_URL` (parsed)                          | `githubcache`                         |
| Tables             | `COUNT(*) FROM information_schema.TABLES`        | `42`                                  |
| Total size         | `SUM(DATA_LENGTH + INDEX_LENGTH)`                | `1.4 GB`                              |
| Active connections | `Threads_connected / max_connections`            | `12 / 151`                            |
| Last backup        | most recent file in `./backups/`                 | `4h ago` (amber > 24h, red > 7d)      |

The Last backup chip is computed from `listBackups()` server-side, so
no new DB query is required.

A second row below the KPIs shows three secondary signals:

- **Cache hit rate** — from
  `Innodb_buffer_pool_read_requests` vs `Innodb_buffer_pool_reads`,
  rendered as a small bar + percent.
- **Binary readiness** — reuses the existing `BinaryWarning` but
  collapsed by default into a 1-line status (`mysqldump: ok ·
  gzip: missing`) that expands on click.
- **Slow query log availability** — whether the DB user has the
  `PROCESS` privilege to read `performance_schema.events_statements_*`.

### 4.2 Backup

Moves the current `BackupSection` content into its own tab. Visual
update:

- Section header gets a green left-border strip and a "Non-destructive"
  badge to make it visually distinct from Restore.
- The retention hint (`keepN`) moves from a paragraph into the table's
  caption row so it's adjacent to the data.
- The "Back up now" button moves to the top-right of the section header
  so it's reachable without scrolling past an empty list.
- The empty state uses the existing `AdminEmptyState` atom with a
  short copy ("No backups yet — your first backup is one click away").
- The list table sorts by `mtime DESC` server-side (it already does;
  verify and document).

### 4.3 Restore — danger zone

This is the core safety upgrade. The section is wrapped in a new
`<aside className="ghc-danger-zone">` container with these properties:

- **Background**: muted red wash (`var(--admin-danger-bg)`).
- **Border**: 2px solid `var(--admin-danger)` left edge, full height.
- **Header**: 🚫 emoji + "Danger zone — destructive operation" text +
  one-line plain-language description: "Replaces the entire live
  database. The current DB is automatically snapshotted to
  `./backups/` before the restore runs. If the restore fails, the
  snapshot is restored back automatically."

Below the header, the existing two-mode (existing backup / upload) UI
is preserved, but the confirmation flow becomes:

1. Pick source (existing backup `<select>` or upload `<input
   type="file">`).
2. Read and **check** a `<input type="checkbox">` labeled "I understand
   this replaces the entire live database." (single click, but
   requires reading).
4. Type the literal string `RESTORE` in a monospace input (existing
   behavior).
5. The submit button shows the destructive action label
   ("Replace database with this backup") and remains disabled until
   **all three** of (source picked, checkbox checked, text matches).

The button uses the existing `ghc-btn-danger` class. On submit success,
the success feedback message explicitly names the pre-restore backup
filename so the operator can verify the safety net actually ran.

### 4.4 Tables

Update to the current `TablesSection`:

- The default state is **all collapsed**. Each row shows: Model,
  Table, Rows, Size, [Expand] button.
- A new toolbar above the table:
  - Sort: `Size desc` (default) | `Rows desc` | `Name asc`
  - Filter: a text input that matches against `model` OR `table` OR
    any column name (case-insensitive).
  - "Expand all" / "Collapse all" buttons.
- Each row's [Expand] toggles the inline columns + indexes view (no
  behavior change there).
- The detail cell uses the existing `.ghc-admin-detail-grid` styling
  but adds a small note explaining where the row count comes from
  (`information_schema.tables.TABLE_ROWS — approximate for InnoDB`).

### 4.5 Queries

Update to the current `SlowQueriesSection`:

- Default sort: by total latency desc (`SUM_TIMER_WAIT` desc).
- Toolbar above the table:
  - Sort: `Total latency` (default) | `Avg latency` | `Calls` |
    `Rows examined avg`
  - Filter: a text input that matches against the SQL digest (the
    truncated query text already shown).
  - Note: "Slow query log requires the DB user to have PROCESS
    privilege. If empty, run `GRANT PROCESS ON *.* TO 'user'@'host'`
    on the MySQL server."
- Empty state: same `AdminEmptyState` atom with a short copy that
  distinguishes "no slow queries recorded" from "PROCESS privilege
  missing" (the second case shows a small banner with the GRANT
  command).

### 4.6 Studio

Update to the current `PrismaStudioLink`:

- Replace the prose paragraph with a one-line command snippet in a
  monospace block: `npx prisma studio --browser none` (the user's
  terminal-launch command), plus a hint that clicking the button
  opens Prisma Studio in their default browser on port 5556.
- The existing link to `/api/admin/database/prisma-studio` (or
  wherever the launch endpoint is — verify) stays.

## 5. Server-side data fetch

The page is still a server component. One `Promise.all` collects all
data needed across all tabs. New server-side helpers:

- `getDatabaseMetrics()` — adds `uptime`, `activeConnections`,
  `maxConnections`, `bufferPoolHitRatio`, `processPrivilege`. Returns
  a single object; if any sub-query fails, returns `null` for that
  field and the section renders "unavailable" instead of crashing.
- `getLastBackupAge(backups)` — pure function, derives age + chip
  severity from the existing `backups` array. Returns `null` when
  no backups exist.

The existing `getDatabaseOverview`, `getTableStats`, `getTableDetails`,
`topSlowQueries`, `listBackups`, `getBinaryStatus` stay as-is.

## 6. Reusable atoms / new atoms

### 6.1 Existing atoms reused

- `AdminPageHeader` (already in use)
- `AdminFilterBar` (used for the Tables + Queries toolbar)
- `AdminTable` (used for the three tables)
- `AdminEmptyState` (new — used in 4.2, 4.4, 4.5)
- `AdminKpiCard` (new — used in 4.1)
- `AdminStatusChip` (new — used for binary readiness, last backup
  age, cache hit rate)
- `AdminConfirmDialog` (new — for delete backup confirmation,
  replacing `window.confirm`)

### 6.2 New atoms

- `AdminTabs` — a horizontal tab bar atom. Props:
  `tabs: Array<{ id: string; label: string }>`, `active: string`,
  `onChange?: (id: string) => void`. Renders a `<nav>` with anchor
  links; when `onChange` is omitted, uses native hash navigation
  (default for this page).
- `AdminDangerZone` — the `<aside className="ghc-danger-zone">`
  wrapper from §4.3. Props: `title`, `description`, children. Adds
  the red-border container + standard header.
- `AdminKpiCard` — see §6.1; used in 4.1.

All new atoms live in `src/app/admin/_components/` and use the
existing `ghc-admin-*` CSS class naming. No new CSS framework
dependency.

## 7. Styling — additions to `src/app/globals.css`

```css
/* Danger zone container — Restore section */
.ghc-danger-zone {
  border-left: 2px solid var(--admin-danger, #d14545);
  background: var(--admin-danger-bg, rgba(209, 69, 69, 0.06));
  padding: 1.25rem 1.5rem;
  border-radius: 0 6px 6px 0;
}

/* Tab bar */
.ghc-admin-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--admin-border);
  margin-bottom: 1.5rem;
  position: sticky;
  top: 0;
  background: var(--admin-bg);
  z-index: 5;
}
.ghc-admin-tab {
  padding: 0.5rem 1rem;
  border: none;
  background: none;
  color: var(--admin-muted);
  font-family: var(--mono);
  font-size: 0.875rem;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  text-decoration: none;
}
.ghc-admin-tab[aria-current="page"] {
  color: var(--admin-fg);
  border-bottom-color: var(--admin-accent);
}

/* KPI grid */
.ghc-admin-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

/* Cache hit rate bar */
.ghc-admin-bar {
  height: 6px;
  background: var(--admin-border);
  border-radius: 3px;
  overflow: hidden;
}
.ghc-admin-bar-fill {
  height: 100%;
  background: var(--admin-accent);
  transition: width 200ms ease;
}
```

All new vars (`--admin-danger`, `--admin-danger-bg`, `--admin-accent`)
are either existing or added as fallbacks with the values shown in
parentheses, so the page degrades gracefully if a variant doesn't
declare them.

## 8. i18n additions

`messages/en.json` + `messages/zh.json` gain keys under
`admin.database`:

- `tabs.{overview,backup,restore,tables,queries,studio}` — labels
- `overview.kpi.{version,uptime,host,database,tables,totalSize,activeConnections,lastBackup}`
- `overview.lastBackup.unavailable` — "No backups yet"
- `overview.lastBackup.ago` — "{hours}h ago" / "{days}d ago"
- `overview.binary.line` — one-line status copy
- `overview.cacheHitRate.unavailable` — "Cache stats unavailable"
- `dangerZone.title` — "Danger zone — destructive operation"
- `dangerZone.description` — see §4.3
- `dangerZone.checkbox` — "I understand this replaces the entire live database."
- `dangerZone.submitLabel` — "Replace database with this backup"
- `restore.sectionWarning` — replaces the existing `warning`
- `tables.toolbar.{sortSize,sortRows,sortName,filterPlaceholder,expandAll,collapseAll}`
- `tables.approxNote` — row count approximation note
- `queries.toolbar.{sortTotal,sortAvg,sortCalls,sortRows,filterPlaceholder}`
- `queries.privilegeMissing` — see §4.5
- `studio.command` — the command snippet
- `studio.hint` — port 5556 + auto-launch

Coverage is enforced by `tests/unit/i18n-coverage.test.ts` — both
languages must have identical key paths.

## 9. Out of scope (defer)

- Backup / restore to a remote object store (S3, etc.) — current
  local-disk model stays.
- Automatic scheduled backups — current "Back up now" manual model
  stays. (Could be a future M28.x task.)
- Live connection list (currently active queries) — only count + max
  are surfaced, not the list of running queries.
- Custom restore point-in-time — current model restores a whole file.

## 10. Migration / rollback

This is a UI-only change. No DB schema changes. No API contract
changes. The existing REST endpoints stay verbatim.

To roll back: revert the working tree to the commit before this
branch. The page goes back to its current 7-section layout. No data
loss possible because no destructive operation's confirmation
semantics were weakened — they were only strengthened.

## 11. Success criteria

- All quality gates green: `npm run typecheck`, `npm run lint`,
  `npm test` (no new pre-existing failures introduced).
- Visual regression: a smoke test (`tests/integration/admin-database.test.ts`
  if it doesn't already exist; otherwise add to the existing one) that
  asserts all six tabs render their section heading and that the
  Restore tab's danger-zone wrapper is present.
- Manual smoke: open `/admin/database` in three admin variants and
  confirm the tab bar + KPI grid + danger zone render correctly.
- Manual safety check: confirm the Restore submit button stays
  disabled until all three of (source picked, checkbox checked,
  `RESTORE` typed).
- i18n parity: `tests/unit/i18n-coverage.test.ts` green for both
  languages.

## 12. Risks

| Risk                                                                                             | Mitigation                                                                       |
|--------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
| New CSS vars don't exist in some admin variants                                                  | All new vars have fallback values in the declaration                              |
| KPI grid stretches awkwardly on narrow viewports                                                  | `auto-fit minmax(160px, 1fr)` collapses to 1 column on small screens             |
| Tab bar sticky overlaps other admin chrome                                                       | Test with the admin shell's top bar; adjust `top` if necessary                   |
| Restore confirmation UI becomes too cumbersome for legit use                                       | Keep the three gates minimal — no extra captcha, no extra page, no extra timeout  |
| `SHOW STATUS` queries don't have permission                                                       | Wrap in try/catch; `getDatabaseMetrics` returns nulls; KPI card shows "—" + small note |
| Snapshot of large DB before restore takes minutes and looks like a hang                          | Show progress feedback if `restore.ts` doesn't already (verify); spec assumes it does |

## 13. Implementation outline (will become a writing-plans plan)

Roughly 6-8 implementation tasks:

1. Add new CSS to `globals.css` (`ghc-danger-zone`, `ghc-admin-tabs`,
   `ghc-admin-kpi-grid`, `ghc-admin-bar`).
2. Add `AdminKpiCard`, `AdminTabs`, `AdminDangerZone` atoms in
   `src/app/admin/_components/`.
3. Extend `src/lib/database/overview.ts` with `getDatabaseMetrics()`.
4. Add i18n keys to both `messages/en.json` and `messages/zh.json`.
5. Rewrite `src/app/admin/database/page.tsx` as the new tab shell
   that loads everything and renders 6 sections.
6. Rewrite each section component (`overview.tsx`, `backup-section.tsx`,
   `restore-section.tsx`, `tables-section.tsx`, `slow-queries-section.tsx`,
   `prisma-studio-link.tsx`).
7. Add `tests/integration/admin-database-tabs.test.ts` covering tab
   presence + danger-zone class + Restore triple-gate disabled state.
8. Smoke test + manual verify + capture before/after screenshots.

---

**Awaiting user review.** Once approved, this spec moves to the
writing-plans skill to produce a task-by-task implementation plan.