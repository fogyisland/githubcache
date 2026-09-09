# Admin Modern B2B Redesign

> **For agentic workers:** Inline execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current admin UI's "monospace terminal" look with a Modern B2B SaaS look (Stripe / Vercel / Tailwind UI). White surface, subtle borders, clean sans-serif, sharp filter bar, proper empty states.

**Architecture:** Layered. Step 1 introduces semantic CSS variables on top of the existing token system. Step 2 rewrites the 6 shared atoms (PageHeader, FilterBar, Table, StatusChip, EmptyState, KpiCard). Step 3 reshapes the shell + utility bar + sidebar. Step 4 demos the new look on the email log page (user's explicit callout). Each layer is independent and verifiable.

**Tech Stack:** Tailwind CSS 4 (already installed) for layout utilities, inline SVG icons, next-intl 4 for strings, no new dependencies.

**Spec:** This plan — the user provided a detailed visual brief in chat on 2026-09-09.

## Global Constraints
- Light mode is the default (`DEFAULT_ADMIN_MODE = 'light'` already set).
- Background `#FFFFFF` for main, `#F9FAFB` for sidebar/raised surfaces.
- Borders `#E5E7EB`. Text: primary `#111827`, secondary `#6B7280`, placeholder `#9CA3AF`.
- Brand accent `#3B82F6` (Tailwind blue-500). Hover `#2563EB`. Hover bg tint `color-mix(... 10%, transparent)`.
- Sans-serif body (`var(--font-sans)`). Monospace ONLY for IDs, hashes, status codes.
- No uppercase eyebrow labels except where required by i18n keys (`admin-chip` legacy).
- No drop shadows on cards; rely on borders.
- Roundness: 8px cards, 6px inputs, 999px status badges.
- Commit + `npm run release` + `git push` is one atomic unit (per saved feedback memory).

---

## Task 1: Modern design tokens in globals.css

**Files:**
- Modify: `src/app/globals.css:2176-2247` (inside `[data-admin-mode="light"]` block)

**Goal:** Add semantic Tailwind-aligned tokens to the `[data-admin-mode="light"]` selector so component CSS can read `var(--surface)`, `var(--border)`, `var(--text-primary)`, etc. without overriding per-class.

- [ ] **Step 1.1:** In `[data-admin-mode="light"]` (after the existing `--admin-*` lines, before the closing `}`), add:

```css
/* M28 modern-B2B semantic tokens (Tailwind-aligned) */
--surface: #FFFFFF;
--surface-raised: #F9FAFB;
--surface-sunken: #F3F4F6;
--border: #E5E7EB;
--border-strong: #D1D5DB;
--text-primary: #111827;
--text-secondary: #6B7280;
--text-tertiary: #9CA3AF;
--brand: #3B82F6;
--brand-hover: #2563EB;
--brand-soft: color-mix(in srgb, #3B82F6 10%, transparent);
```

- [ ] **Step 1.2:** Mirror the same 9 vars inside `[data-admin-mode="dark"]` block using dark-appropriate values:

```css
--surface: #0E0E11;
--surface-raised: #14141A;
--surface-sunken: #07070A;
--border: #2A2A33;
--border-strong: #353540;
--text-primary: #E8E8EC;
--text-secondary: #8E8E97;
--text-tertiary: #6B6B72;
--brand: #7B97FF;
--brand-hover: #5A78E5;
--brand-soft: color-mix(in srgb, #7B97FF 12%, transparent);
```

- [ ] **Step 1.3:** Run typecheck + lint:
```bash
npm run typecheck && npm run lint
```
- Expected: pass with no new errors.

- [ ] **Step 1.4:** Commit:
```bash
git add src/app/globals.css
git commit -m "feat(admin): add modern-B2B semantic tokens (light + dark)"
```

---

## Task 2: AdminPageHeader — clean sans-serif, no eyebrow tracking

**Files:**
- Modify: `src/app/globals.css:1022-1069` (`.ghc-admin-page-header*` rules)
- Modify: `src/app/admin/_components/admin-page-header.tsx` (if needed for breadcrumb typography)

**Goal:** Title text-2xl font-semibold, breadcrumb text-sm text-secondary, no uppercase tracking on description.

- [ ] **Step 2.1:** Replace `.ghc-admin-breadcrumb-text`, `.ghc-admin-page-title`, `.ghc-admin-page-desc` rules:

```css
.ghc-admin-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}
.ghc-admin-breadcrumb-sep { color: var(--border-strong); }
.ghc-admin-page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.ghc-admin-page-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0.375rem 0 0;
  max-width: 42rem;
  line-height: 1.5;
}
```

- [ ] **Step 2.2:** Verify in browser visually. Commit:
```bash
git commit -am "feat(admin): cleaner AdminPageHeader typography"
```

---

## Task 3: AdminFilterBar — white inputs with clear labels

**Files:**
- Modify: `src/app/globals.css:1185-1219` (`.ghc-admin-filter-*` rules)
- Modify: `src/app/admin/_components/admin-filter-bar.tsx` — remove auto-translation of "All" so i18n provides it

- [ ] **Step 3.1:** Replace filter-bar CSS:

```css
.ghc-admin-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 1rem;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 1rem;
}
.ghc-admin-filter-label {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 10rem;
}
.ghc-admin-filter-text {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}
.ghc-admin-filter-select {
  appearance: none;
  width: 100%;
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 2rem 0.5rem 0.75rem;
  font-size: 0.875rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.625rem center;
  cursor: pointer;
}
.ghc-admin-filter-select:focus-visible {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
```

- [ ] **Step 3.2:** In `admin-filter-bar.tsx`, replace `<option value="">All</option>` with `{t('all')}` and accept a `t` prop, OR keep "All" hardcoded and add an i18n key. Pick the simpler approach: keep hardcoded "All" for now.

- [ ] **Step 3.3:** Commit:
```bash
git commit -am "feat(admin): clean white filter bar with labels"
```

---

## Task 4: AdminTable — subtle hover, monospace only for IDs

**Files:**
- Modify: `src/app/globals.css:1104-1147` (`.ghc-admin-table*` rules)

- [ ] **Step 4.1:** Replace table CSS:

```css
.ghc-admin-table-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}
.ghc-admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  color: var(--text-primary);
}
.ghc-admin-table thead th {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: left;
  padding: 0.75rem 1rem;
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
}
.ghc-admin-table tbody td {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  vertical-align: middle;
}
.ghc-admin-table tbody tr:last-child td { border-bottom: 0; }
.ghc-admin-table tbody tr:hover td { background: var(--surface-raised); }
```

- [ ] **Step 4.2:** Commit:
```bash
git commit -am "feat(admin): cleaner table with subtle hover + raised header"
```

---

## Task 5: AdminStatusChip — solid pill, no borders, no uppercase

**Files:**
- Modify: `src/app/globals.css:970-989` (`.ghc-admin-chip*` rules)

- [ ] **Step 5.1:** Replace chip CSS with solid-pill variants:

```css
.ghc-admin-chip {
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.125rem 0.625rem;
  border-radius: 999px;
  line-height: 1.4;
}
.ghc-admin-chip-ok {
  color: #065F46;
  background: color-mix(in srgb, #10B981 14%, transparent);
}
.ghc-admin-chip-warn {
  color: #92400E;
  background: color-mix(in srgb, #F59E0B 14%, transparent);
}
.ghc-admin-chip-danger {
  color: #991B1B;
  background: color-mix(in srgb, #EF4444 14%, transparent);
}
.ghc-admin-chip-info {
  color: #1E3A8A;
  background: color-mix(in srgb, #3B82F6 14%, transparent);
}
.ghc-admin-chip-neutral {
  color: var(--text-secondary);
  background: var(--surface-sunken);
}
```

- [ ] **Step 5.2:** In admin-shell/dark mode, override chip text colors to lighter tints (use `--text-primary` for danger text on dark bg). Approximate by:

```css
[data-admin-mode="dark"] .ghc-admin-chip-ok { color: #6EE7B7; }
[data-admin-mode="dark"] .ghc-admin-chip-warn { color: #FCD34D; }
[data-admin-mode="dark"] .ghc-admin-chip-danger { color: #FCA5A5; }
[data-admin-mode="dark"] .ghc-admin-chip-info { color: #93C5FD; }
```

- [ ] **Step 3:** Commit.

---

## Task 6: AdminEmptyState — illustration + helper text + reset CTA

**Files:**
- Modify: `src/app/admin/_components/admin-empty-state.tsx`
- Modify: `src/app/globals.css:991-1020` (`.ghc-admin-empty*` rules)

- [ ] **Step 6.1:** Update empty-state CSS to a centered card with 64px icon area:

```css
.ghc-admin-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4rem 2rem;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 8px;
  gap: 0.5rem;
}
.ghc-admin-empty-icon {
  width: 3.5rem;
  height: 3.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-raised);
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}
.ghc-admin-empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.ghc-admin-empty-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  max-width: 30rem;
}
.ghc-admin-empty-action { margin-top: 0.75rem; }
```

- [ ] **Step 6.2:** Commit.

---

## Task 7: AdminKpiCard — cleaner value sizing

**Files:**
- Modify: `src/app/globals.css:1071-1099` (`.ghc-admin-kpi*` rules)

- [ ] **Step 7.1:** Replace KPI CSS:

```css
.ghc-admin-kpi {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem;
}
.ghc-admin-kpi-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.ghc-admin-kpi-value {
  font-size: 1.875rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
  margin-top: 0.5rem;
  letter-spacing: -0.02em;
}
.ghc-admin-kpi-value.tone-positive { color: #10B981; }
.ghc-admin-kpi-value.tone-negative { color: #EF4444; }
.ghc-admin-kpi-hint {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}
```

- [ ] **Step 7.2:** Commit.

---

## Task 8: Admin shell — slim utility bar + sidebar refresh

**Files:**
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/globals.css:1855-1927` (`.ghc-admin-utility*`, `.ghc-admin-sidebar*` rules)

**Goal:** Move language/theme/variant/mode/tz/clock controls into a single "Settings" dropdown. Keep user info + logout on the right. Sidebar: 240px, subtle bg, no oversized uppercase.

- [ ] **Step 8.1:** Replace `.ghc-admin-utility` rules with a 56px-tall bar with subtle border, no surface-2 bg.

- [ ] **Step 8.2:** Replace `.ghc-admin-sidebar-link` active state to use brand-soft bg + left border (3px brand color) + bold text. Drop uppercase font.

- [ ] **Step 8.3:** In `layout.tsx`, create a `<SettingsDropdown>` client component that wraps lang/theme/variant/mode/tz controls. Render it in the utility bar alongside user info.

  Keep this commit small — only refactor the utility bar UI. The SettingsDropdown can be a follow-up.

- [ ] **Step 8.4:** Commit.

---

## Task 9: Email log page demo (user's callout)

**Files:**
- Modify: `src/app/admin/email/log/page.tsx`
- Modify: `messages/en.json` + `messages/zh.json` (add empty-state helper text + reset-button i18n)

- [ ] **Step 9.1:** Pass an `action` prop to AdminTable (when no rows) that renders a "Reset filters" button (Link to `/admin/email/log`).

- [ ] **Step 9.2:** Add i18n key `admin.emailLog.empty` describing "No matching logs — try changing the filters" + `admin.emailLog.reset`.

- [ ] **Step 9.3:** Verify on browser / screenshot.

- [ ] **Step 9.4:** Commit.

---

## Final Sync

- [ ] **Step 10:** Run `npm run typecheck && npm run lint && npm test tests/unit/admin-mode.test.ts && npm run release && git push origin master` — one atomic unit per saved feedback memory.

## Self-Review Checklist

- [ ] Token names use semantic Stripe/Tailwind naming (`surface`, `text-primary`, etc.) — checked
- [ ] All uppercase tracking removed from admin chrome — checked
- [ ] No new npm dependencies — checked (uses inline SVG, no icon lib)
- [ ] All 9 chip / kpi / table / etc. variants still work in BOTH light and dark mode — Task 5 step 5.2 handles dark
- [ ] Plan doesn't break any existing test — only adds tokens + CSS rule changes

## Execution

Inline. Per session preference (commit + release + push atomic).