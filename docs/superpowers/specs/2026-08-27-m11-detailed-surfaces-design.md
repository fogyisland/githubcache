# M11 — Detailed Public + Admin Surface — Design

**Date:** 2026-08-27
**Status:** Draft (awaiting user review)
**Milestone tag target:** `m11-detailed-surfaces`

---

## 1. Problem

After M10 shipped a three-theme public site, two surfaces remain under-developed:

**Public site (`/`, `/repo/[owner]/[name]`)** is too thin:
- 3 sections total (hero + form + recent lookups). No social proof, no API doc, no
  example repos, no "how it works" narrative.
- Hero is generic ("Submit a repo, get metadata"). Doesn't differentiate from
  GitHub's own UI or any random cache service.
- Footer has only two links. No version, no source, no status.

**Admin (`/admin/*`)** is genuinely unfinished:
- 7 pages with bare `<table>` / `<h1>` / `<dl>` — no `ghc-*` component classes on
  Users / API Keys / GitHub Tokens; only Audit / Refresh / Reports have any
  wrapper.
- `reports/_components/kpi-cards.tsx` uses hardcoded `border-gray-200 bg-white`
  (not theme-aware — worse than templated).
- `admin/layout.tsx` crams all nav into one `ghc-card` — no sidebar, no breadcrumb,
  no persistent status bar.
- `admin/page.tsx` is M7's placeholder ("Logged in as X").
- No ⌘K command palette. No destructive-action confirm dialog. No shared
  table / filter / KPI / chip / empty-state components. Every page reinvents them.

**Consequence:** visitors get a marketing-lite page with no depth; operators get
an unfinished control panel. Both surfaces confuse their roles.

---

## 2. Goal

Two deliverables, one milestone:

1. **Public site depth.** Make `/` a real project-site landing — stats bar,
   features, how-it-works, API doc, quick-try, footer. Detail page gains an API
   shape tab for developers.
2. **Admin redesign.** Replace bare tables with a real admin shell (sidebar +
   status bar + command palette + page header pattern) backed by a shared
   component library. Rewrite all 7 admin pages on top of it. Three design
   directions, switchable.

Both surfaces follow the existing M10 three-theme system (terminal / editorial /
brutalist). Admin additionally has its own **three design directions** that are
**independent of the public theme**.

---

## 3. Non-goals

- No new DB schema (we already have `User.theme` from M10 — adding
  `User.adminVariant` is the only schema change).
- No new API endpoints beyond M11-required (CSV export, command palette data
  source).
- No mobile-first redesign (admin is operator-facing, desktop-only acceptable;
  public site stays mobile-friendly but is not the focus).
- No dark mode / light mode toggle — theme switching already covers this.
- No i18n.
- No real-time websocket push (status bar polls every 10s — sufficient).

---

## 4. Architecture

### 4.1 Public site

**`src/app/page.tsx`** becomes a vertical stack of 7 sections (each is a
`<section>` with its own `ghc-*` class composition):

1. **Hero** — existing, sharpened copy + small inline SVG (GitHub mark + cache
   layers).
2. **Stats bar** (`ghc-stats-bar`) — 4 numbers fetched from `/api/v1/status`:
   `cached_repos`, `requests_24h`, `avg_latency_ms`, `uptime_since`. Numbers
   animate in on first paint.
3. **Features** — 3-up grid: Instant (`< 50ms`), Cached (`< 24h fresh`),
   Rate-limited (`30/min/IP`). Each has icon + headline + 1-line demo.
4. **How it works** — 3 numbered steps (01 / 02 / 03): Query → Cache → Return.
   Inline SVG diagram per step.
5. **API doc** (`ghc-api-doc`) — curl example + response shape (truncated JSON
   rendered with syntax highlighting via `ghc-code-block`). Link to full docs.
6. **Quick try** — 3 buttons pre-filled with `torvalds/linux`,
   `microsoft/vscode`, `vitejs/vite`. Each is a server-action form.
7. **Footer** — version (from `package.json`), source link (GitHub repo),
   `/api/v1/status`, `/login`. 3 columns.

**Detail page (`/repo/[owner]/[name]`)** gains a new `<details>` block:
"API response shape" — collapsible JSON dump of the canonical response.
Pure progressive enhancement; default collapsed.

**Site header** is demoted: "Status" and "Admin" become ghost links in the top
right; hero is the visual focus.

### 4.2 Admin — three design directions

Three variants, all theme-aware (follow chosen public theme's tokens), all
sharing the **same component library** (so the admin looks like the same
product across variants — only the chrome changes):

| ID | Mood | Palette anchor | Type signature | Signature element |
|---|---|---|---|---|
| `mission-control` | Ops bridge / radar HUD | `#0E1116` slate + `#F0B429` amber + `#39BAE6` cyan | All JetBrains Mono, tabular nums, uppercase eyebrows | **Persistent bottom status bar** (DB ms · queue depth · scheduler state · current user · theme) with blinking cursor on live values |
| `inspector` | Forensic audit / paper trail | `#FBFAF6` cream + `#1A1A1A` ink + `#5C5C5C` graphite | Fraunces serif display + IBM Plex Sans body + Plex Mono nums | **Persistent right audit sidebar** (last 10 entries across the app) + destructive-action "diff" confirmation |
| `workbench` | Assembly manual / IKEA | `#FFFFFF` white + `#0033FF` electric blue + `#1A1A1A` graphite | Space Grotesk 700 labels + Inter body + JetBrains Mono nums | **Numbered workflow rail** (01 → 02 → 03) per page showing operator's progress + oversized hero stat |

Each variant has **one real aesthetic risk** (own it):
- mission-control: looks like a 2003 sysadmin CRT
- inspector: feels like an IRS form (calm deliberation)
- workbench: feels like an IKEA manual (assembly clarity)

The variants are **independent of the public theme**. Operator can be in
`workbench` admin + `editorial` public — different audiences, different moods.

### 4.3 Admin shell

**`src/app/admin/_components/admin-shell.tsx`** wraps every admin page:

```
┌─────────────────────────────────────────────────┐
│  SIDEBAR (variant-specific)  │   MAIN (children) │
│  ┌────────────────────────┐  │  ┌──────────────┐ │
│  │ ⌘ Command palette      │  │  │ Page header  │ │
│  │ ─ Dashboard            │  │  │  breadcrumb  │ │
│  │ ─ Users                │  │  │  title       │ │
│  │ ─ API Keys             │  │  │  actions     │ │
│  │ ─ GitHub Tokens        │  │  ├──────────────┤ │
│  │ ─ Reports              │  │  │              │ │
│  │ ─ Audit                │  │  │  Page body   │ │
│  │ ─ Refresh              │  │  │              │ │
│  └────────────────────────┘  │  │              │ │
│                              │  │              │ │
│  [mission-control only]      │  │              │ │
│  ┌────────────────────────┐  │  └──────────────┘ │
│  │ STATUS BAR (bottom)    │  │                    │
│  │ DB ping · queue · ...  │  │                    │
│  └────────────────────────┘  │                    │
└─────────────────────────────────────────────────┘
```

**Sidebar**: 7 sections, SVG icons (16×16), current-section indicator (left
border), role-gated (operator sees fewer). Collapsible on `<1024px` viewport.

**Status bar** (mission-control only): sticky bottom, 4 columns —
`DB · 12ms` · `QUEUE · 3` · `SCHEDULER · RUNNING` · `me@x (admin) · [T/E/B]`.
Polled every 10s via client component.

**Command palette**: ⌘K / Ctrl+K opens centered modal. Fuzzy-search across the
7 admin sections + recent audit entries (last 5). Client component,
`useEffect` keyboard listener, `framer-motion`-free (CSS transitions only).

### 4.4 Component library

`src/app/admin/_components/` (11 files):

1. **`admin-shell.tsx`** — wraps pages, decides which variant chrome to render
2. **`admin-sidebar.tsx`** — 7 sections, icons, current-section indicator
3. **`admin-status-bar.tsx`** — mission-control only, polled status
4. **`admin-variant-switcher.tsx`** — T/I/W pills, server action
5. **`command-palette.tsx`** — ⌘K modal, fuzzy search
6. **`admin-page-header.tsx`** — breadcrumb + title + actions slot
7. **`admin-table.tsx`** — header / rows / empty / loading / pagination
8. **`admin-kpi-card.tsx`** — theme-aware (replaces the gray-200 one)
9. **`admin-status-chip.tsx`** — variants: ok / warn / danger / neutral / info
10. **`admin-empty-state.tsx`** — icon + headline + subtext + optional CTA
11. **`admin-confirm-dialog.tsx`** — destructive action confirmation

CSS lives in `globals.css` under `[data-admin="mission-control"]`,
`[data-admin="inspector"]`, `[data-admin="workbench"]` blocks. Each defines
`--admin-bg`, `--admin-ink`, `--admin-accent`, `--admin-rule`, etc. Component
classes read from variables — variant switching = one attribute change.

### 4.5 Variant data flow

```
[admin layout (server)]
  → cookies() → read cookie "ghc_admin_variant" + DB User.adminVariant
  → render <html data-theme="X" data-admin="Y">
[admin shell (server)]
  → render sidebar + status bar + page header
[status bar (client)]
  → polls /api/v1/status every 10s
[command palette (client)]
  → useEffect listens for ⌘K / Ctrl+K
  → opens <dialog>, fuzzy searches admin sections + recent audit
[variant switcher (client)]
  → POST setAdminVariantAction
  → sets cookie + DB; revalidatePath('/', 'layout')
```

---

## 5. Data model

Single new field:

```prisma
enum AdminVariant {
  mission_control  @map("mission_control")
  inspector
  workbench
}

model User {
  // ...existing...
  adminVariant  AdminVariant @default(mission_control) @map("admin_variant")
}
```

Migration: `m11_admin_variant`. New column default `mission_control` for
existing users (matches current chrome's closest variant — dark + monospace).

---

## 6. API surface

New endpoints (admin-only):

- **`GET /api/v1/admin/status`** — full status payload (db ping, queue, scheduler,
  recent audit count, variant) for the status bar. Polled every 10s.
- **`GET /api/v1/admin/palette`** — list of admin section titles + slugs + icons
  for the command palette. Static.

Existing endpoints unchanged.

---

## 7. File structure

```
src/
├── app/
│   ├── page.tsx                                    (rewrite — 7 sections)
│   ├── _components/
│   │   ├── stats-bar.tsx                           (new)
│   │   ├── features-section.tsx                    (new)
│   │   ├── how-it-works.tsx                        (new)
│   │   ├── api-doc-section.tsx                     (new)
│   │   ├── quick-try.tsx                           (new)
│   │   └── site-footer.tsx                         (new)
│   ├── repo/[owner]/[name]/
│   │   ├── page.tsx                                (modify — add API shape <details>)
│   │   └── _components/api-shape.tsx               (new)
│   └── admin/
│       ├── layout.tsx                              (rewrite — use AdminShell)
│       ├── _components/                            (new directory)
│       │   ├── admin-shell.tsx
│       │   ├── admin-sidebar.tsx
│       │   ├── admin-status-bar.tsx
│       │   ├── admin-variant-switcher.tsx
│       │   ├── command-palette.tsx
│       │   ├── admin-page-header.tsx
│       │   ├── admin-table.tsx
│       │   ├── admin-kpi-card.tsx
│       │   ├── admin-status-chip.tsx
│       │   ├── admin-empty-state.tsx
│       │   └── admin-confirm-dialog.tsx
│       ├── _actions/
│       │   └── admin-variant.ts                    (new)
│       ├── page.tsx                                (rewrite — real dashboard)
│       ├── users/page.tsx                          (rewrite)
│       ├── users/[id]/page.tsx                     (rewrite)
│       ├── api-keys/page.tsx                       (rewrite)
│       ├── api-keys/[id]/page.tsx                  (rewrite)
│       ├── github-tokens/page.tsx                  (rewrite)
│       ├── github-tokens/[id]/page.tsx             (new — drill-down)
│       ├── reports/page.tsx                        (rewrite + date picker)
│       ├── audit/page.tsx                          (rewrite + diff view)
│       ├── refresh/page.tsx                        (rewrite + scheduler state)
│       └── api/
│           └── v1/admin/
│               ├── status/route.ts                 (new)
│               └── palette/route.ts                (new)
└── lib/
    └── admin/
        └── variant.ts                              (new — registry, cookie, resolve)

prisma/
├── schema.prisma                                   (modify — AdminVariant + User.adminVariant)
└── migrations/m11_admin_variant/                   (new — generated)

src/app/globals.css                                 (rewrite — 3 [data-admin] blocks)
tests/unit/admin-variant.test.ts                    (new)
tests/unit/admin-table.test.ts                      (new)
tests/integration/admin-pages.test.ts               (new)
docs/superpowers/plans/2026-08-27-m11-detailed-surfaces.md  (new)
```

Approximate file count: ~30 new, ~15 modified.

---

## 8. Testing

**Unit (vitest)** — `tests/unit/`:
- `admin-variant.test.ts` — registry, isAdminVariant, resolveAdminVariant,
  cookie roundtrip, buildSetCookie.
- `admin-table.test.ts` — renders headers/rows, empty state, loading state,
  pagination links, status chips.
- `command-palette.test.tsx` — fuzzy search ranks sections correctly, ⌘K
  listener registers, recent audit fetched.

**Integration** — `tests/integration/`:
- `admin-pages.test.ts` — each of 7 admin pages returns 200 with valid session,
  contains expected components (sidebar, page header, status bar [mission-control]).
- `admin-variant-switch.test.ts` — POST sets cookie + DB, GET reflects new variant.

**E2E (playwright)** — optional, defer to M12.

**Manual verification**:
- `curl` each admin variant — verify `data-admin` attribute on `<html>`.
- ⌘K opens palette in browser.
- Variant switch repaints without flash.

---

## 9. Risks and trade-offs

- **Risk:** too much in one milestone (35+ files, 7 page rewrites, 11 new
  components, 3 design directions). **Mitigation:** break into sub-tasks
  M11.1 → M11.10, each committable + testable independently. Spec is the
  binding authority; if scope creeps, defer to M12.
- **Risk:** variants look identical at a glance (only chrome differs).
  **Mitigation:** each variant has a *signature element* documented above —
  status bar / audit sidebar / workflow rail. These are unmistakable.
- **Risk:** command palette scope creep (becomes a search engine). **Scope:**
  searches 7 admin sections + 5 recent audit entries only. No global repo
  search.
- **Risk:** theme × variant combinatorial explosion (3 × 3 = 9 looks to test).
  **Mitigation:** variants follow theme tokens, so the only thing that changes
  between variants is the chrome (sidebar position, status bar presence,
  serif/mono choice for headings). Test per-variant under one theme
  (`terminal`) — visual regression sufficient.

---

## 10. Migration / rollback

- `npx prisma migrate deploy` — adds `admin_variant` column default
  `mission_control`. Existing users land on the closest dark/mono variant.
- Rollback: drop column, revert layout.tsx to one-line nav, drop admin shell +
  components.
- No data loss either direction.

---

## 11. Open questions

None blocking. User has approved:
- Scope: both surfaces in M11.
- Admin: three design directions, switchable, independent of public theme.

---

## 12. Spec self-review

- [x] No placeholders ("TBD", "TODO later", "similar to X") — every section
      specifies what ships.
- [x] Internal consistency — variant mapping consistent across §4.2, §4.4, §7.
- [x] Scope check — single milestone focused on public + admin surface depth.
      New admin auth / new API contract / new persistence layer out of scope.
- [x] Ambiguity check — "page header pattern" defined with breadcrumb + title +
      actions slot; "command palette" scoped to 7 sections + 5 recent audit;
      "variant" defined as `data-admin` attribute with 3 fixed values.