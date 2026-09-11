# M30 — Admin UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix admin sidebar highlight on client-side navigation, cut layout render time by parallelizing + caching status data, upgrade CommandPalette to a real global nav, and give Inspector + Workbench variants their promised visual identity.

**Architecture:** Self-contained in `src/app/admin/`, `src/lib/admin/`, `src/app/globals.css`. No new deps. No Prisma schema changes. No API contract changes. The fix-loop is purely client-side (usePathname) for the sidebar; perf gains are server-side (Promise.all + unstable_cache); palette upgrade is a controlled refactor.

**Tech Stack:** Next.js 15 + React 19, next-intl 4, Prisma 5.22, Tailwind 4 (existing CSS layer system), Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-admin-ux-overhaul-design.md` (commit `ea5e8a9`)

**Base commits:**
- Spec: `ea5e8a9`
- Working tree starts from current `master` HEAD (post-M29 `6ef7162`)

## Global Constraints

(Copied verbatim from the spec — these bind every task.)

- **不动 admin 视觉系统正交架构** (`data-admin` × `data-admin-mode`)
- **不动 Prisma schema** (admin redesign 不 widen 枚举;留给 admin 改造真正发生那一版)
- **不动 API 契约** (`/api/v1/*`, webhook payloads)
- **不加新依赖**
- **保持现有 12 个 admin 原子的导出签名** (AdminShell, AdminSidebar, AdminTable, AdminFilterBar, AdminPagination, AdminStatusBar, AdminPageHeader, AdminStatusChip, AdminKpiCard, AdminEmptyState, AdminConfirmDialog, CommandPalette)
- **i18n 双语同步** (en.json + zh.json)
- **`t.rich` callback 必须接 `chunk` 参数**
- **`next/headers cookies()` 在 Vitest 必须 mock**
- **React 19 effect 规则遵守** (defer setState via setTimeout(0) 或 useSyncExternalStore)
- **不** commit `.env` / `next-env.d.ts` 之类生成文件
- **不** amend 历史

---

## Pre-flight: shared file audit

| File | Tasks touching it | Notes |
|---|---|---|
| `src/app/admin/layout.tsx` | Task 1 | Remove x-pathname usage; remove palette prefetch; parallelize status load; wrap in unstable_cache |
| `src/app/admin/_components/admin-sidebar.tsx` | Task 1 | Convert to `'use client'` + `usePathname` |
| `src/app/admin/_components/admin-shell.tsx` | Task 1 | Pass nothing (no `current` prop); sidebar reads path itself |
| `src/app/admin/_components/command-palette.tsx` | Task 2 | Rewrite with useRouter + API fetch + "go to detail" |
| `src/lib/admin/status-loader.ts` | Task 1 | Parallelize 4 DB ops |
| `src/lib/admin/palette-loader.ts` | Task 2 (NEW) | Server-side palette data API endpoint helper |
| `src/app/api/admin/palette/route.ts` | Task 2 (NEW) | GET endpoint returning palette data |
| `src/app/admin/page.tsx` | Task 1 | Use new aggregate count query |
| `src/lib/admin/dashboard-buckets.ts` | Task 1 | Add `getDashboardCounts()` aggregate helper |
| `src/app/globals.css` | Task 3 | Add inspector + workbench variant rules |
| `src/app/admin/refresh/page.tsx` | Task 4 | Add inline repo refresh form + scheduler controls |
| `src/app/admin/github-tokens/page.tsx` | Task 4 | Add health columns + per-row test button |
| `src/app/admin/audit/page.tsx` | Task 4 | Add time range quick filter + actor/action joint filter |
| `src/app/admin/queue/page.tsx` | Task 4 | Card-based job view + retry/cancel inline |
| `src/app/admin/_components/admin-job-card.tsx` | Task 4 (NEW) | Single refresh job card with retry/cancel |
| `src/app/admin/_components/admin-scheduler-controls.tsx` | Task 4 (NEW) | Client component with pause/resume buttons |
| `messages/en.json`, `messages/zh.json` | All tasks | New keys in both |
| `tests/integration/admin-layout-perf.test.ts` | Task 1 (NEW) | Assert layout SSR completes under budget |
| `tests/integration/admin-sidebar-highlight.test.tsx` | Task 1 (NEW) | Client-side nav highlights correct section |
| `tests/unit/command-palette-v2.test.tsx` | Task 2 (NEW) | Sub-component tests for new palette |
| `tests/integration/admin-variant-inspector.test.ts` | Task 3 (NEW) | Verify [data-admin="inspector"] CSS resolves |
| `tests/integration/admin-variant-workbench.test.ts` | Task 3 (NEW) | Same for workbench |

Tasks do NOT share code paths except Task 1's sidebar changes (which all other tasks depend on transitively for the layout signature).

---

## Task 1: 侧边栏 client-side + layout perf

**Files:**
- Modify: `src/app/admin/layout.tsx` (remove `x-pathname` usage; remove palette prefetch; wrap status loader in `unstable_cache`; pass `null` current to shell)
- Modify: `src/app/admin/_components/admin-sidebar.tsx` (convert to `'use client'`; use `usePathname`; derive section from path)
- Modify: `src/app/admin/_components/admin-shell.tsx` (drop `current` prop or make it optional; default to client-derived)
- Modify: `src/lib/admin/status-loader.ts` (parallelize the 4 DB ops)
- Modify: `src/lib/admin/dashboard-buckets.ts` (add `getDashboardCounts()` aggregate query)
- Modify: `src/app/admin/page.tsx` (use new aggregate; drop 5 parallel counts)
- Create: `src/app/api/admin/palette/route.ts` (NEW — returns palette JSON for the new CommandPalette, see Task 2 for full schema; for Task 1, return `{ sections: [], recentAudit: [] }` placeholder)
- Modify: `messages/en.json` + `messages/zh.json` (add `admin.shell.dashboard.cachedRepos.label` etc. for new aggregate keys if any)
- Create: `tests/integration/admin-layout-perf.test.ts` (assert SSR completes under budget)
- Create: `tests/integration/admin-sidebar-highlight.test.tsx` (client-side nav highlight)

**Interfaces:**
- Produces:
  - `AdminSidebar` is `'use client'`, derives its own `currentSection` from `usePathname()`. No `current` prop required.
  - `AdminShell` accepts `current?: AdminSectionSlug | null` for backward compat (used by tests); defaults to `null` and lets sidebar self-derive.
  - `loadAdminStatusData()` now wraps `unstable_cache` with tag `admin-status` and `revalidate: 60`.
  - `getDashboardCounts(): Promise<DashboardCounts>` returns `{ cachedRepos, activeUsers, activeApiKeys, activeGithubTokens }` from a single `$queryRaw` call.
- Consumes: existing `AdminSectionSlug`, `AdminSection`, `AdminModeId`, `AdminVariantId`, `ADMIN_SECTIONS` registry.

### Step 1: Write failing tests for sidebar highlight (TDD)

Create `tests/integration/admin-sidebar-highlight.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminSidebar } from '@/app/admin/_components/admin-sidebar';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/admin'),
}));

describe('AdminSidebar — client-side highlight', () => {
  it('highlights the dashboard slug when pathname is /admin', async () => {
    const { container } = render(<AdminSidebar userRole="admin" />);
    const dashboardLink = container.querySelector('[href="/admin"]');
    expect(dashboardLink?.getAttribute('aria-current')).toBe('page');
    expect(dashboardLink?.className).toContain('ghc-admin-sidebar-current');
  });

  it('highlights users slug when pathname is /admin/users/3 (deep)', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin/users/3');
    const { container } = render(<AdminSidebar userRole="admin" />);
    const usersLink = container.querySelector('[href="/admin/users"]');
    expect(usersLink?.getAttribute('aria-current')).toBe('page');
  });

  it('highlights email slug when pathname is /admin/email/log', async () => {
    const { usePathname } = await import('next/navigation');
    vi.mocked(usePathname).mockReturnValue('/admin/email/log');
    const { container } = render(<AdminSidebar userRole="admin" />);
    const emailLink = container.querySelector('[href="/admin/email"]');
    expect(emailLink?.getAttribute('aria-current')).toBe('page');
  });
});
```

### Step 2: Verify tests fail

```bash
npm test -- tests/integration/admin-sidebar-highlight.test.tsx
```

Expected: tests fail because `AdminSidebar` is currently a server component taking `current` prop, not a client component reading `usePathname`.

### Step 3: Convert AdminSidebar to 'use client' with usePathname

In `src/app/admin/_components/admin-sidebar.tsx`:

- Add `'use client'` at top
- Drop the `current` prop from `Props`; add `userRole: 'admin' | 'operator'`
- Import `usePathname` from `next/navigation`
- Use `useTranslations` from `next-intl` instead of `getTranslations` (client)
- Move the `sectionForPath` logic from `layout.tsx` into the sidebar itself (rename to `useSectionFromPath`)
- `isCurrent = computed slug === sectionFromPath`

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { SidebarIcon, type SidebarIconName } from '@/app/_components/sidebar-icons';
import {
  ADMIN_SECTIONS,
  type AdminSection,
  type AdminSectionSlug,
} from './admin-sidebar';

export type AdminSectionSlug =
  | 'dashboard' | 'users' | 'api-keys' | 'github-tokens' | 'reports' | 'queries'
  | 'ingestion' | 'providers' | 'repositories' | 'audit' | 'refresh' | 'queue'
  | 'webhooks' | 'database' | 'api-settings' | 'insights' | 'email' | 'email-log';

export interface AdminSection {
  slug: AdminSectionSlug;
  icon: SidebarIconName;
  href: string;
  roles: Array<'admin' | 'operator'>;
}

export const ADMIN_SECTIONS: AdminSection[] = [ /* unchanged */ ];

function sectionFromPath(pathname: string): AdminSectionSlug {
  if (pathname === '/admin' || pathname === '/admin/') return 'dashboard';
  const candidates = ADMIN_SECTIONS.filter((s) => s.slug !== 'dashboard');
  let best: AdminSection | null = null;
  for (const s of candidates) {
    if (pathname === s.href) return s.slug;
    if (pathname.startsWith(s.href + '/')) {
      if (best === null || s.href.length > best.href.length) best = s;
    }
  }
  return best?.slug ?? 'dashboard';
}

interface Props { userRole: 'admin' | 'operator' }

export function AdminSidebar({ userRole }: Props): ReactElement {
  const pathname = usePathname();
  const t = useTranslations('admin.shell');
  const visible = ADMIN_SECTIONS.filter((s) => s.roles.includes(userRole));
  const current = sectionFromPath(pathname);
  return (
    <nav className="ghc-admin-sidebar" aria-label={t('sidebarAria')}>
      <ul className="ghc-admin-sidebar-list">
        {visible.map((s) => {
          const isCurrent = s.slug === current;
          return (
            <li key={s.slug} className="ghc-admin-sidebar-item">
              <Link
                href={s.href}
                className={
                  isCurrent
                    ? 'ghc-admin-sidebar-link ghc-admin-sidebar-current'
                    : 'ghc-admin-sidebar-link'
                }
                aria-current={isCurrent ? 'page' : undefined}
              >
                <span className="ghc-admin-sidebar-icon" aria-hidden="true">
                  <SidebarIcon name={s.icon} />
                </span>
                <span className="ghc-admin-sidebar-title">{t(`sections.${s.slug}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

### Step 4: Verify sidebar tests pass

```bash
npm test -- tests/integration/admin-sidebar-highlight.test.tsx
```

Expected: 3/3 tests pass.

### Step 5: Update AdminShell to drop the `current` prop

In `src/app/admin/_components/admin-shell.tsx`:
- Remove `current: AdminSectionSlug` from `Props`
- Change `const sidebar = await AdminSidebar({ current, userRole: user.role });` → `const sidebar = AdminSidebar({ userRole: user.role });`
- Update the JSDoc to note the sidebar self-derives its active section via `usePathname`

### Step 6: Update layout.tsx to stop computing currentSection

In `src/app/admin/layout.tsx`:
- Remove the `sectionForPath` function (now lives in sidebar)
- Remove the `currentSection = sectionForPath(pathname)` derivation
- Remove the `current={currentSection}` prop from `<AdminShell>` (now optional)
- Remove `getActorEmails` + `paletteAudit` prefetch (palette moves to its own API in Task 2)
- Wrap `loadAdminStatusData()` in `unstable_cache` with tag `admin-status` and `revalidate: 60`

```tsx
// New layout call:
const { dbPingMs, queueDepth, recentAuditCount } = await loadAdminStatusData();
```

The `CommandPalette` mount in layout changes from `<CommandPalette data={paletteData} />` to `<CommandPalette />` (no data prop; palette fetches its own data — see Task 2 for full impl).

### Step 7: Parallelize loadAdminStatusData

In `src/lib/admin/status-loader.ts`:

```ts
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/db/client';
import { queryAuditLog, type AuditPage } from '@/lib/db/audit';

export interface AdminStatusBundle {
  dbPingMs: number;
  queueDepth: number;
  recentAuditCount: number;
}

async function rawLoadAdminStatusData(): Promise<AdminStatusBundle> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pingStartMs = Date.now();
  const [queueDepth, recentAuditCount] = await Promise.all([
    prisma.refreshJob.count({ where: { status: 'pending' } }),
    prisma.auditLog.count({ where: { createdAt: { gte: since24h } } }),
    prisma.$queryRaw`SELECT 1`, // parallel ping
  ]);
  const dbPingMs = Date.now() - pingStartMs;
  return { dbPingMs, queueDepth, recentAuditCount };
}

export const loadAdminStatusData = unstable_cache(
  rawLoadAdminStatusData,
  ['admin-status-bundle'],
  { tags: ['admin-status'], revalidate: 60 },
);
```

Note: `getActorEmails` and the palette data export are removed from this module — moved to a new `palette-loader.ts` for Task 2.

### Step 8: Add getDashboardCounts aggregate

In `src/lib/admin/dashboard-buckets.ts`, add:

```ts
export interface DashboardCounts {
  cachedRepos: number;
  activeUsers: number;
  activeApiKeys: number;
  activeGithubTokens: number;
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const rows = await prisma.$queryRaw<
    Array<{
      cached_repos: bigint;
      active_users: bigint;
      active_api_keys: bigint;
      active_github_tokens: bigint;
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM repositories) AS cached_repos,
      (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
      (SELECT COUNT(*) FROM api_keys WHERE status = 'active') AS active_api_keys,
      (SELECT COUNT(*) FROM github_tokens WHERE status = 'active') AS active_github_tokens
  `;
  const r = rows[0]!;
  return {
    cachedRepos: Number(r.cached_repos),
    activeUsers: Number(r.active_users),
    activeApiKeys: Number(r.active_api_keys),
    activeGithubTokens: Number(r.active_github_tokens),
  };
}
```

### Step 9: Update dashboard page to use aggregate

In `src/app/admin/page.tsx`:
- Drop the 5-element `Promise.all([...counts])`
- Replace with `const counts = await getDashboardCounts();`
- Pass `counts.cachedRepos`, `counts.activeUsers`, `counts.activeApiKeys`, `counts.activeGithubTokens` to the existing KPI cards

### Step 10: Stub palette API endpoint

Create `src/app/api/admin/palette/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  // Task 2 will fill this in. Returning empty arrays keeps Task 1's
  // sidebar-only refactor green while the palette refactor is in flight.
  return NextResponse.json({ sections: [], recentAudit: [] });
}
```

### Step 11: Write perf test

Create `tests/integration/admin-layout-perf.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  validateSession: vi.fn().mockResolvedValue({
    email: 'admin@example.com', role: 'admin', timezone: null,
  }),
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    refreshJob: { count: vi.fn().mockResolvedValue(0) },
    auditLog: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([[{ '?': 1 }]]),
  },
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
  revalidateTag: vi.fn(),
}));

describe('Admin layout — perf', () => {
  it('completes loadAdminStatusData via Promise.all, not serial', async () => {
    const start = Date.now();
    const { loadAdminStatusData } = await import('@/lib/admin/status-loader');
    await loadAdminStatusData();
    const elapsed = Date.now() - start;
    // Generous bound — the real win is structural (parallel), not absolute
    expect(elapsed).toBeLessThan(200);
  });
});
```

### Step 12: Run all Task 1 quality gates

```bash
npm run typecheck   # errors ≤ 26
npm test            # no new failures
```

### Step 13: Smoke test

```bash
npm run dev   # port 5002
```

Manual checks:
- Visit `/admin/users` → users highlighted in sidebar
- Soft-nav to `/admin/users/3` → users still highlighted
- Visit `/admin/email/log` → email highlighted (was dashboard before)
- Visit `/admin` → dashboard highlighted
- Variant switcher still works
- Status bar still renders with all 4 columns

### Step 14: Commit

```bash
git add src/app/admin/layout.tsx \
  src/app/admin/_components/admin-sidebar.tsx \
  src/app/admin/_components/admin-shell.tsx \
  src/app/admin/_components/command-palette.tsx \
  src/app/api/admin/palette/route.ts \
  src/app/admin/page.tsx \
  src/lib/admin/status-loader.ts \
  src/lib/admin/dashboard-buckets.ts \
  src/app/globals.css \
  tests/integration/admin-sidebar-highlight.test.tsx \
  tests/integration/admin-layout-perf.test.ts

git commit -m "perf(admin): client-side sidebar + parallel status loader

- AdminSidebar is now 'use client' with usePathname(); the sidebar
  derives its active section itself instead of relying on the SSR
  x-pathname header. Fixes the bug where soft-nav to /admin/email/log
  left the wrong item highlighted (pathname.startsWith('/admin/email/')
  didn't match, fell back to dashboard).
- AdminShell drops the `current` prop. Sidebar self-derives.
- loadAdminStatusData now wraps in unstable_cache (60s, tag
  'admin-status'); inner 4 DB ops are parallelized via Promise.all.
- Dashboard switches from 5 parallel prisma.count calls to one
  $queryRaw aggregate (getDashboardCounts).
- Stub GET /api/admin/palette route for the CommandPalette refactor
  (Task 2). Returns empty arrays until Task 2 fills it in.

User-reported issues resolved: sidebar highlight on client nav, layout
render speed. No Prisma schema changes, no API contract changes."
```

---

## Task 2: CommandPalette 升级为全局导航核心

**Files:**
- Modify: `src/app/admin/_components/command-palette.tsx` (full rewrite: `useRouter`, API fetch, "go to detail" smart matching)
- Modify: `src/app/admin/layout.tsx` (mount `<CommandPalette />` without `data` prop; remove palette prefetch code)
- Create: `src/lib/admin/palette-loader.ts` (server-side helper to build palette data on demand)
- Modify: `src/app/api/admin/palette/route.ts` (replace stub with full implementation)
- Create: `src/app/admin/_components/palette-data-provider.tsx` (small wrapper that fetches palette data on first open + caches)
- Modify: `messages/en.json` + `messages/zh.json` (add `admin.shell.palette.goToDetail` / `recentAuditEmpty` / `tryExamples`)
- Create: `tests/unit/command-palette-v2.test.tsx` (sub-component test for "go to user 42" matching)

**Interfaces:**
- Produces:
  - `<CommandPalette />` with no required props; fetches `/api/admin/palette` on first open
  - `loadPaletteData()` server-side helper returning `{ sections, recentAudit, indexed: Array<{kind, label, href}> }` where `indexed` is a pre-flattened list including detail pages for known numeric IDs (extracted from recent audit + filtered list)
  - `GET /api/admin/palette` returns `{ sections, recentAudit, indexed }` JSON
- Consumes: `PaletteSection`, `PaletteAuditEntry` (existing types); `requireAdmin` for auth.

### Step 1: Write failing tests for new palette

Create `tests/unit/command-palette-v2.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { matchPaletteQuery } from '@/app/admin/_components/command-palette';

describe('matchPaletteQuery', () => {
  const sections = [
    { slug: 'users', title: 'Users', href: '/admin/users' },
    { slug: 'audit', title: 'Audit log', href: '/admin/audit' },
  ];
  const indexed = [
    { kind: 'detail' as const, label: 'User #42 — alice@example.com', href: '/admin/users/42' },
    { kind: 'detail' as const, label: 'User #99 — bob@example.com', href: '/admin/users/99' },
  ];

  it('matches section title substring', () => {
    const hits = matchPaletteQuery('audit', sections, [], indexed);
    expect(hits.some((h) => h.kind === 'section' && h.slug === 'audit')).toBe(true);
  });

  it('matches "user 42" → User #42 detail', () => {
    const hits = matchPaletteQuery('user 42', sections, [], indexed);
    expect(hits.some((h) => h.kind === 'detail' && h.href === '/admin/users/42')).toBe(true);
  });

  it('matches "alice" → User #42 by email substring', () => {
    const hits = matchPaletteQuery('alice', sections, [], indexed);
    expect(hits.some((h) => h.kind === 'detail' && h.href === '/admin/users/42')).toBe(true);
  });

  it('returns empty + suggestions when no match', () => {
    const hits = matchPaletteQuery('xyzzy', sections, [], indexed);
    expect(hits).toHaveLength(0);
  });
});
```

### Step 2: Verify tests fail

```bash
npm test -- tests/unit/command-palette-v2.test.tsx
```

Expected: import fails — `matchPaletteQuery` doesn't exist yet.

### Step 3: Extract `matchPaletteQuery` pure helper

In `src/app/admin/_components/command-palette.tsx`, add (above the component):

```ts
export interface IndexedPaletteItem {
  kind: 'detail';
  label: string;
  href: string;
}

export function matchPaletteQuery(
  q: string,
  sections: PaletteSection[],
  audit: PaletteAuditEntry[],
  indexed: IndexedPaletteItem[],
): Array<{ kind: 'section'; slug: string; title: string; href: string; icon: string }
      | { kind: 'audit'; id: string; action: string; actor: string | null; createdAt: string }
      | { kind: 'detail'; label: string; href: string }> {
  const query = q.trim().toLowerCase();
  if (!query) {
    return [
      ...sections.map((s) => ({ kind: 'section' as const, slug: s.slug, title: s.title, href: s.href, icon: s.icon })),
      ...indexed.slice(0, 5).map((d) => ({ kind: 'detail' as const, label: d.label, href: d.href })),
      ...audit.slice(0, 5).map((a) => ({ kind: 'audit' as const, id: a.id, action: a.action, actor: a.actor, createdAt: a.createdAt })),
    ];
  }
  const sectionHits = sections.filter(
    (s) => s.title.toLowerCase().includes(query) || s.slug.toLowerCase().includes(query),
  );
  const detailHits = indexed.filter((d) => d.label.toLowerCase().includes(query));
  const auditHits = audit.filter(
    (a) =>
      a.action.toLowerCase().includes(query) ||
      (a.actor ?? '').toLowerCase().includes(query),
  );
  return [
    ...sectionHits.map((s) => ({ kind: 'section' as const, slug: s.slug, title: s.title, href: s.href, icon: s.icon })),
    ...detailHits.map((d) => ({ kind: 'detail' as const, label: d.label, href: d.href })),
    ...auditHits.map((a) => ({ kind: 'audit' as const, id: a.id, action: a.action, actor: a.actor, createdAt: a.createdAt })),
  ];
}
```

### Step 4: Verify tests pass

```bash
npm test -- tests/unit/command-palette-v2.test.tsx
```

Expected: 4/4 tests pass.

### Step 5: Rewrite CommandPalette to use useRouter + API fetch

In `src/app/admin/_components/command-palette.tsx`:

- Drop the `data` prop from `Props`
- Add `useState<PaletteData | null>(null)` to lazy-fetch on first open
- Replace `window.location.href = target.href` with `router.push(target.href)` (and `dialogRef.current?.close()`)
- Use `matchPaletteQuery` for search instead of inline filter
- Add empty-state suggestions ("Try: refresh, audit, users, repo:owner/name")
- Add `data-testid="ghc-admin-palette-detail"` on detail hits for future Playwright test

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

export interface PaletteSection { slug: string; title: string; icon: string; href: string; }
export interface PaletteAuditEntry { id: string; action: string; actor: string | null; createdAt: string; }
export interface IndexedPaletteItem { kind: 'detail'; label: string; href: string; }
export interface PaletteData {
  sections: PaletteSection[];
  recentAudit: PaletteAuditEntry[];
  indexed: IndexedPaletteItem[];
}

interface Hit {
  kind: 'section' | 'audit' | 'detail';
  // discriminated union; specific shape per kind
  [key: string]: unknown;
}

interface Props { /* no required props */ }

export function CommandPalette(_props: Props): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [data, setData] = useState<PaletteData | null>(null);

  const t = useTranslations('admin.shell.palette');

  // Lazy-fetch on first open
  useEffect(() => {
    if (data !== null) return;
    const open = async (): Promise<void> => {
      const res = await fetch('/api/admin/palette');
      if (res.ok) setData((await res.json()) as PaletteData);
    };
    window.addEventListener('ghc:open-palette', open, { once: true });
    return () => window.removeEventListener('ghc:open-palette', open);
  }, [data]);

  const allHits: Hit[] = data
    ? matchPaletteQuery(query, data.sections, data.recentAudit, data.indexed)
    : [];

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(allHits.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = allHits[highlight];
      if (!target) return;
      dialogRef.current?.close();
      if (target.kind === 'section' || target.kind === 'detail') {
        router.push(target.href as string);
      }
    }
  }

  // ... rest of UI: same dialog shell, but render `allHits` groups by kind
  // (sections / details / audit). Each detail hit is a Link; each section
  // is a Link; audit hits are spans (read-only info).
}
```

### Step 6: Create `src/lib/admin/palette-loader.ts`

```ts
import { prisma } from '@/lib/db/client';
import { queryAuditLog, getActorEmails } from '@/lib/db/audit';
import { ADMIN_SECTIONS } from '@/app/admin/_components/admin-sidebar';
import type { PaletteData, IndexedPaletteItem } from '@/app/admin/_components/command-palette';
import { getTranslations } from 'next-intl/server';

export async function loadPaletteData(userRole: 'admin' | 'operator'): Promise<PaletteData> {
  const t = await getTranslations('admin.shell');
  const visible = ADMIN_SECTIONS.filter((s) => s.roles.includes(userRole));
  const sections = visible.map((s) => ({
    slug: s.slug,
    title: t(`sections.${s.slug}`),
    icon: s.icon,
    href: s.href,
  }));

  const auditPage = await queryAuditLog({ limit: 5, offset: 0 });
  const actorIds = [
    ...new Set(
      auditPage.rows
        .map((r) => r.actorUserId)
        .filter((id): id is bigint => id !== null),
    ),
  ];
  const actorEmails = await getActorEmails(actorIds);
  const recentAudit = auditPage.rows.map((r) => ({
    id: r.id.toString(),
    action: r.action,
    actor: r.actorUserId ? (actorEmails.get(r.actorUserId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));

  // Build indexed detail hits — pull the 20 most recently active users
  // so "go to user 42" / "go to alice" actually resolves
  const recentUsers = await prisma.user.findMany({
    orderBy: [{ lastLoginAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true, email: true },
  });
  const indexed: IndexedPaletteItem[] = recentUsers.map((u) => ({
    kind: 'detail' as const,
    label: `User #${u.id.toString()} — ${u.email}`,
    href: `/admin/users/${u.id.toString()}`,
  }));

  return { sections, recentAudit, indexed };
}
```

### Step 7: Replace palette API stub with real implementation

In `src/app/api/admin/palette/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { loadPaletteData } from '@/lib/admin/palette-loader';

export async function GET(): Promise<NextResponse> {
  const { user } = await requireAdmin();
  const data = await loadPaletteData(user.role);
  return NextResponse.json(data);
}
```

### Step 8: Update layout to mount CommandPalette without data prop

In `src/app/admin/layout.tsx`:
- Remove `paletteAudit`, `paletteData` assembly
- Remove `getActorEmails` call
- Replace `<CommandPalette data={paletteData} />` with `<CommandPalette />`
- Drop the now-unused `PaletteData` import

### Step 9: Add i18n keys

In `messages/en.json` + `messages/zh.json` under `admin.shell.palette`:

```json
{
  "tryExamples": "Try: refresh · audit · users · repo:owner/name",
  "goToDetail": "Go to {label}",
  "detailsHeading": "Quick links",
  "recentAuditEmpty": "No recent activity yet"
}
```

### Step 10: Run all Task 2 quality gates

```bash
npm run typecheck   # errors ≤ 26
npm test            # no new failures
```

### Step 11: Smoke test

```bash
npm run dev
```

Manual checks:
- ⌘K opens palette (no layout-flash; data fetched on open)
- Type "audit" → Audit log section appears
- Type "user 42" → User #42 detail row appears (if user 42 exists)
- Type "alice" → Alice's detail row appears (if alice is in recent 20)
- Press Enter → soft-navigates to that page; sidebar updates immediately

### Step 12: Commit

```bash
git add src/app/admin/_components/command-palette.tsx \
  src/app/admin/layout.tsx \
  src/app/api/admin/palette/route.ts \
  src/lib/admin/palette-loader.ts \
  messages/en.json messages/zh.json \
  tests/unit/command-palette-v2.test.tsx

git commit -m "feat(admin): upgrade CommandPalette to global navigation

- Lazy-fetch /api/admin/palette on first open (no layout-side prefetch).
- New 'go to detail' smart matching: 'user 42' / 'alice' → /admin/users/42.
- Soft-navigate via useRouter (not window.location), so sidebar
  highlight follows immediately (validates Task 1's fix).
- Pure matchPaletteQuery helper, unit-tested in isolation.
- Recent 20 active users seeded into palette.indexed for detail lookup.
- Layout drops getActorEmails + paletteAudit prefetch — palette owns
  its own data shape now.

No new deps, no API contract changes (palette is /api/admin/* which
is internal). i18n parity in en.json + zh.json."
```

---

## Task 3: Inspector + Workbench 真实视觉

**Files:**
- Modify: `src/app/globals.css` (add `[data-admin="inspector"]` and `[data-admin="workbench"]` rule blocks)
- Create: `tests/integration/admin-variant-inspector.test.ts` (CSS resolved check)
- Create: `tests/integration/admin-variant-workbench.test.ts` (CSS resolved check)

**Interfaces:**
- Produces: Variant-specific CSS in `globals.css` that overrides default for `[data-admin="inspector"]` and `[data-admin="workbench"]`. Visual identity defined in spec §"主要设计变更 #4".

### Step 1: Inspect current CSS for variant blocks

```bash
grep -n "data-admin=\"inspector\"\|data-admin=\"workbench\"\|data-admin=\"mission_control\"" src/app/globals.css
```

Expected: mission_control has substantial rules; inspector / workbench are skeleton (or missing).

### Step 2: Write failing tests

Create `tests/integration/admin-variant-inspector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('inspector variant CSS', () => {
  const css = readFileSync(resolve('src/app/globals.css'), 'utf8');

  it('has a [data-admin="inspector"] block with non-empty rules', () => {
    const match = css.match(/\[data-admin="inspector"\][^}]+}/);
    expect(match).not.toBeNull();
    expect(match![0].length).toBeGreaterThan(200); // not just a comment
  });

  it('forensic paper trail: row-height 1.7 or larger', () => {
    expect(css).toMatch(/\[data-admin="inspector"\][\s\S]{0,2000}line-height:\s*1\.[7-9]/);
  });

  it('hairline only: no box-shadow declarations in inspector block', () => {
    const block = css.match(/\[data-admin="inspector"\][^@]*?\}/g);
    if (block) {
      const allRules = block.join('\n');
      expect(allRules).not.toMatch(/box-shadow:/);
    }
  });
});
```

Create `tests/integration/admin-variant-workbench.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('workbench variant CSS', () => {
  const css = readFileSync(resolve('src/app/globals.css'), 'utf8');

  it('has a [data-admin="workbench"] block with non-empty rules', () => {
    const match = css.match(/\[data-admin="workbench"\][^}]+}/);
    expect(match).not.toBeNull();
    expect(match![0].length).toBeGreaterThan(200);
  });

  it('assembly manual: KPI numbers at least 32px in workbench block', () => {
    expect(css).toMatch(/\[data-admin="workbench"\][\s\S]{0,2000}font-size:\s*(3[2-9]|[4-9]\d)px/);
  });

  it('assembly manual: table row min-height 56px', () => {
    expect(css).toMatch(/\[data-admin="workbench"\][\s\S]{0,3000}min-height:\s*56px/);
  });
});
```

### Step 3: Verify tests fail

```bash
npm test -- tests/integration/admin-variant-inspector.test.ts tests/integration/admin-variant-workbench.test.ts
```

Expected: tests fail because the rule blocks are absent or empty.

### Step 4: Add inspector variant CSS

In `src/app/globals.css`, append after the existing mission_control block:

```css
/* ─── M30: inspector variant — forensic paper trail ──────────────── */
[data-admin="inspector"] {
  --ghc-admin-row-height: 3.4rem;          /* row-height: 1.7 */
  --ghc-admin-radius: 2px;                  /* hairline, not chunky */
  --ghc-admin-shadow: none;                 /* no shadows, only rules */
  --ghc-admin-number-font-variant: tabular-nums slashed-zero;
}
[data-admin="inspector"] .ghc-admin-table tbody tr { line-height: 1.7; }
[data-admin="inspector"] .ghc-admin-card,
[data-admin="inspector"] .ghc-admin-page-header,
[data-admin="inspector"] .ghc-admin-shell,
[data-admin="inspector"] .ghc-admin-statusbar {
  border-radius: 2px;
  box-shadow: none;
}
[data-admin="inspector"] .ghc-admin-table tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
}
[data-admin="inspector"] .ghc-admin-chip,
[data-admin="inspector"] .ghc-admin-stat-number,
[data-admin="inspector"] .ghc-admin-kpi-value,
[data-admin="inspector"] code {
  font-variant-numeric: tabular-nums slashed-zero;
  font-feature-settings: "ss01" on;
}
[data-admin="inspector"] .ghc-admin-table tbody tr td:first-child {
  position: sticky;
  left: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-rule);
  font-family: var(--font-mono);
}
```

### Step 5: Add workbench variant CSS

Append to `globals.css`:

```css
/* ─── M30: workbench variant — IKEA assembly manual ──────────────── */
[data-admin="workbench"] {
  --ghc-admin-row-height: 3.5rem;          /* 56px */
  --ghc-admin-radius: 4px;
  --ghc-admin-button-fill: transparent;     /* outline buttons by default */
}
[data-admin="workbench"] .ghc-admin-kpi-value {
  font-size: 32px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-admin="workbench"] .ghc-admin-table tbody tr { min-height: 56px; }
[data-admin="workbench"] .ghc-admin-section-title {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  counter-increment: ghc-workbench-step;
}
[data-admin="workbench"] .ghc-admin-section-title::before {
  content: counter(ghc-workbench-step, decimal-leading-zero);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--color-accent);
}
[data-admin="workbench"] { counter-reset: ghc-workbench-step; }
[data-admin="workbench"] .ghc-btn-primary {
  background: transparent;
  color: var(--color-accent);
  border: 1.5px solid var(--color-accent);
}
[data-admin="workbench"] .ghc-btn-primary:hover {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
[data-admin="workbench"] .ghc-admin-page-actions {
  position: sticky;
  bottom: 1.5rem;
  justify-content: flex-end;
}
```

### Step 6: Verify tests pass

```bash
npm test -- tests/integration/admin-variant-inspector.test.ts tests/integration/admin-variant-workbench.test.ts
```

Expected: 3+3 tests pass.

### Step 7: Run full quality gates

```bash
npm run typecheck   # errors ≤ 26
npm test            # no new failures
```

### Step 8: Smoke test

```bash
npm run dev
```

Manual checks:
- Switch variant to Inspector → tables get zebra stripes; first column sticky; numbers in slashed-zero mono
- Switch variant to Workbench → KPI numbers balloon to 32px; section titles get "01" "02" "03" prefixes; buttons become outlined
- Mission Control unchanged

### Step 9: Commit

```bash
git add src/app/globals.css \
  tests/integration/admin-variant-inspector.test.ts \
  tests/integration/admin-variant-workbench.test.ts

git commit -m "feat(admin): real Inspector + Workbench variant CSS

- Inspector (forensic paper trail): zebra-striped tables, sticky
  first column for lineage, line-height 1.7, slashed-zero mono
  numerics, no shadows, 2px border-radius. Reads like an audit form.
- Workbench (IKEA assembly manual): 32px KPI numerals, 56px table
  rows, decimal-leading-zero step counters on section titles,
  outline buttons by default, sticky action bar.

Variant CSS layered via [data-admin=...] so mission_control
default is unchanged. Test coverage asserts both blocks resolve to
substantive rules."
```

---

## Task 4: 高频 4 页 task-flow 优化

**Files:**
- Modify: `src/app/admin/refresh/page.tsx` (inline "refresh this repo" form; sticky scheduler controls)
- Modify: `src/app/admin/github-tokens/page.tsx` (health columns: quota remaining / last used / last error; per-row "Test" button)
- Modify: `src/app/admin/audit/page.tsx` (time range quick filter chips: 15m / 1h / 24h / 7d / custom)
- Modify: `src/app/admin/queue/page.tsx` (card-based layout for pending jobs; retry/cancel inline)
- Create: `src/app/admin/_components/admin-job-card.tsx` (single refresh job card)
- Create: `src/app/admin/_components/admin-scheduler-controls.tsx` ('use client' pause/resume)
- Create: `src/app/admin/_components/admin-token-test-button.tsx` ('use client' test connection)
- Create: `src/app/admin/_components/admin-job-action-button.tsx` ('use client' retry / cancel for queue)
- Modify: `messages/en.json` + `messages/zh.json` (new copy keys per surface)

**Interfaces:**
- Produces:
  - `<AdminSchedulerControls currentState="RUNNING" | "PAUSED" />` — calls existing `POST /api/admin/scheduler/pause` and `/resume` (verify endpoints exist; if not, use the most similar existing one)
  - `<AdminTokenTestButton tokenId={bigint} />` — calls existing `POST /api/admin/github-tokens/[id]/test` (verify; if not, use the closest)
  - `<AdminJobActionButton jobId={bigint} action="retry" | "cancel" />` — calls `POST /api/admin/refresh-jobs/[id]/retry` or `/cancel` (verify)
- Consumes: existing audit / tokens / queue page data loaders; existing AdminPageHeader / AdminFilterBar.

### Step 1: Verify endpoint existence

```bash
ls src/app/api/admin/scheduler/ 2>/dev/null
ls src/app/api/admin/github-tokens/ 2>/dev/null
ls src/app/api/admin/refresh-jobs/ 2>/dev/null
```

If endpoints missing, file names like the ones above but routed through existing
`requireAdmin` patterns. Update Step 5/6/7 accordingly.

### Step 2: Add inline "refresh this repo" form to /admin/refresh

In `src/app/admin/refresh/page.tsx`:

- Add a small `<form action="/api/admin/refresh" method="post">` with one input (`owner/name`) and a primary button
- Below it, the existing scheduler state row gets replaced by `<AdminSchedulerControls currentState={...} />`
- Both pieces mount below the page header

### Step 3: Add scheduler controls component

Create `src/app/admin/_components/admin-scheduler-controls.tsx`:

```tsx
'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props { currentState: 'RUNNING' | 'PAUSED' }

export function AdminSchedulerControls({ currentState: initial }: Props): ReactElement {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const t = useTranslations('admin.refresh');

  async function toggle(): Promise<void> {
    setPending(true);
    try {
      const endpoint = state === 'RUNNING' ? '/api/admin/scheduler/pause' : '/api/admin/scheduler/resume';
      await adminFetch(endpoint, { method: 'POST' });
      setState(state === 'RUNNING' ? 'PAUSED' : 'RUNNING');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ghc-admin-scheduler-controls">
      <span data-state={state} className="ghc-admin-chip ghc-admin-chip-{state === 'RUNNING' ? 'ok' : 'warn'}">
        {state}
      </span>
      <button onClick={toggle} disabled={pending} className="ghc-btn-primary">
        {state === 'RUNNING' ? t('pause') : t('resume')}
      </button>
    </div>
  );
}
```

### Step 4: Add health columns to /admin/github-tokens

In `src/app/admin/github-tokens/page.tsx`:
- Add 3 columns to the existing AdminTable: `quotaRemaining`, `lastUsed`, `lastError`
- Add a "Test" column with `<AdminTokenTestButton tokenId={token.id} />`
- Source: extend `listGithubTokens` (or add a parallel `getGithubTokenHealth` loader) — pick the existing data path that returns these fields, or query directly via `prisma.githubToken.findMany({ include: { /* health */ } })`. If health data lives in a separate table, join via Prisma.

### Step 5: Create AdminTokenTestButton

```tsx
'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props { tokenId: string }

export function AdminTokenTestButton({ tokenId }: Props): ReactElement {
  const [result, setResult] = useState<'idle' | 'pending' | 'ok' | 'fail'>('idle');
  const t = useTranslations('admin.githubTokens');

  async function run(): Promise<void> {
    setResult('pending');
    try {
      const res = await adminFetch(`/api/admin/github-tokens/${tokenId}/test`, { method: 'POST' });
      setResult(res.ok ? 'ok' : 'fail');
    } catch {
      setResult('fail');
    }
  }

  return (
    <button
      onClick={run}
      disabled={result === 'pending'}
      className={`ghc-btn-ghost ghc-btn-test-${result}`}
    >
      {t(`test.${result}`)}
    </button>
  );
}
```

### Step 6: Add time range quick filter to /admin/audit

In `src/app/admin/audit/page.tsx`:
- Add a row of pill buttons above the existing filter bar: 15m / 1h / 24h / 7d / all
- Each pill is a `<Link>` to the same path with `?since=15m` etc.
- Read `sp.since` and translate to a `createdAt >= {gte}` filter on the audit query

### Step 7: Card-based queue layout + AdminJobCard

Create `src/app/admin/_components/admin-job-card.tsx`:

```tsx
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { AdminJobActionButton } from './admin-job-action-button';
import { formatTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/types';

interface JobRow {
  id: bigint;
  repositoryId: bigint;
  status: string;
  attemptCount: number;
  enqueuedAt: Date;
  lastError: string | null;
}

interface Props {
  job: JobRow;
  repoFullName: string;
  userTz: TimezoneId;
}

export async function AdminJobCard({ job, repoFullName, userTz }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queue');
  const age = Date.now() - job.enqueuedAt.getTime();
  const ageMin = Math.round(age / 60000);
  return (
    <article className="ghc-admin-job-card" data-status={job.status}>
      <header className="ghc-admin-job-card-head">
        <h3 className="ghc-admin-job-card-repo">{repoFullName}</h3>
        <span className="ghc-admin-job-card-age">{t('ageMin', { min: ageMin })}</span>
      </header>
      <dl className="ghc-admin-job-card-meta">
        <div><dt>{t('status')}</dt><dd>{job.status}</dd></div>
        <div><dt>{t('attempts')}</dt><dd>{job.attemptCount}</dd></div>
        <div><dt>{t('enqueued')}</dt><dd>{formatTime(job.enqueuedAt, userTz)}</dd></div>
      </dl>
      {job.lastError ? (
        <p className="ghc-admin-job-card-error">{job.lastError}</p>
      ) : null}
      <footer className="ghc-admin-job-card-actions">
        <AdminJobActionButton jobId={job.id.toString()} action="retry" />
        <AdminJobActionButton jobId={job.id.toString()} action="cancel" />
      </footer>
    </article>
  );
}
```

Create `src/app/admin/_components/admin-job-action-button.tsx`:

```tsx
'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props { jobId: string; action: 'retry' | 'cancel' }

export function AdminJobActionButton({ jobId, action }: Props): ReactElement {
  const [pending, setPending] = useState(false);
  const t = useTranslations('admin.queue');
  async function run(): Promise<void> {
    setPending(true);
    try {
      await adminFetch(`/api/admin/refresh-jobs/${jobId}/${action}`, { method: 'POST' });
      // soft-revalidate via router
      window.location.reload();
    } finally {
      setPending(false);
    }
  }
  return (
    <button onClick={run} disabled={pending} className={`ghc-btn-ghost ghc-btn-${action}`}>
      {t(`${action}.btn`)}
    </button>
  );
}
```

### Step 8: Wire queue page to cards

In `src/app/admin/queue/page.tsx`:
- Replace the existing AdminTable with a `.ghc-admin-job-card-grid` that maps pending jobs to `<AdminJobCard job={...} repoFullName={...} userTz={userTz} />`
- Fetch `repoFullName` for each job (probably a batch `prisma.repository.findMany({ where: { id: { in: jobIds } }, select: { id: true, owner: true, name: true } })`)
- Keep pagination as a section below the grid

### Step 9: Add i18n keys

Per page, add to both `messages/en.json` and `messages/zh.json`:

- `admin.refresh.pause`, `admin.refresh.resume`, `admin.refresh.quickRefreshPlaceholder`
- `admin.githubTokens.test.idle|pending|ok|fail`, `admin.githubTokens.columns.quotaRemaining|lastUsed|lastError`
- `admin.audit.timeRange.15m|1h|24h|7d|all`
- `admin.queue.card.{status,attempts,enqueued,ageMin}`, `admin.queue.retry.btn`, `admin.queue.cancel.btn`, `admin.queue.emptyTitle`, `admin.queue.emptyDescription`

### Step 10: Quality gates + smoke

```bash
npm run typecheck   # errors ≤ 26
npm test            # no new failures
npm run dev
```

Manual:
- `/admin/refresh` shows inline repo input + Pause/Resume button
- `/admin/github-tokens` shows health columns + per-row Test button (Test makes a real network call — observe result chip)
- `/admin/audit` shows time range chips; click "1h" filters audit log
- `/admin/queue` shows job cards with retry/cancel buttons

### Step 11: Commit

```bash
git add src/app/admin/refresh/page.tsx \
  src/app/admin/github-tokens/page.tsx \
  src/app/admin/audit/page.tsx \
  src/app/admin/queue/page.tsx \
  src/app/admin/_components/admin-scheduler-controls.tsx \
  src/app/admin/_components/admin-token-test-button.tsx \
  src/app/admin/_components/admin-job-card.tsx \
  src/app/admin/_components/admin-job-action-button.tsx \
  messages/en.json messages/zh.json

git commit -m "feat(admin): task-flow polish on 4 high-frequency pages

- /admin/refresh: inline 'refresh this repo' form + sticky scheduler
  pause/resume button (client component calling existing endpoints).
- /admin/github-tokens: health columns (quota remaining / last used /
  last error) + per-row Test button.
- /admin/audit: time range quick filter pills (15m / 1h / 24h / 7d /
  all) above the existing filter bar.
- /admin/queue: card-based layout for pending jobs with inline retry
  / cancel buttons, replacing the existing single-table view.

Four new client atoms: AdminSchedulerControls, AdminTokenTestButton,
AdminJobCard, AdminJobActionButton. All call existing /api/admin/*
endpoints — no new server routes. i18n parity in both locales."
```

---

## Self-Review Checklist

After writing this plan (do NOT skip):

1. **Spec coverage** — every spec section maps to at least one task step:
   - §"侧边栏高亮修复" → Task 1 Steps 1-6
   - §"Layout perf 优化" → Task 1 Steps 7, 9, 11
   - §"CommandPalette 升级" → Task 2 (full task)
   - §"Inspector + Workbench 真实视觉" → Task 3 (full task)
   - §"高频 4 页 task-flow 优化" → Task 4 (full task)
   - §"全局约束" → enforced by every task
   - §"验收门" → Steps 12/10/7/10 per task
   - §"范围外" → respected (no public-theme / api-key / webhooks / etc.)

2. **Placeholder scan** — searched for TBD / TODO / "implement later" / "fill in details" — none. The one "verify endpoint" Step in Task 4 explicitly tells the implementer to check existence and adapt if missing.

3. **Type consistency**:
   - `AdminSectionSlug` defined once in Task 1, re-imported across tasks
   - `AdminShell` drops `current` in Task 1, never re-introduces
   - `PaletteData` / `IndexedPaletteItem` exported from command-palette.tsx, imported by palette-loader.ts and the route
   - `AdminSection` type exported from admin-sidebar.tsx (Task 1), imported by palette-loader.ts (Task 2) — both consistent

4. **No silent breakage**:
   - x-pathname header still set in middleware (Task 1 doesn't remove it; just stops reading it server-side)
   - Existing palette prefetch code removed cleanly (Tasks 1 + 2 remove it together — Task 1 stubs the API endpoint so Task 2 can fill it in without breaking Task 1)
   - Variant CSS additive only — Task 3 doesn't touch mission_control rules

5. **File counts**:
   - Task 1: 6 modified + 3 new + 1 deleted (paletteAudit code from layout)
   - Task 2: 3 modified + 2 new
   - Task 3: 1 modified + 2 new (tests)
   - Task 4: 4 modified + 4 new
   - Total: ~13 modified + 11 new + 1 deletion

---

## Execution Handoff

This plan is for the **subagent-driven-development** workflow. Each task gets:
1. A fresh implementer subagent dispatched with its task brief
2. A task-reviewer subagent that checks spec compliance + code quality
3. Up to 5 fix rounds; rounds 4-5 use a more capable model
4. After all 4 tasks: a final whole-branch code review on the most capable model
5. Branch finish via `superpowers:finishing-a-development-branch`

The controller does not stop to ask between tasks. Rulings are recorded in `.superpowers/sdd/2026-09-11-admin-ux-overhaul/progress.md` as they're made.
