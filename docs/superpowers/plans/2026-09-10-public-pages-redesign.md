# Public Pages Redesign (M29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重设计 `githubcache` 公开页视觉层 —— 把默认主题从 `terminal` 改名为 `professional`、加 `professional-dark` 暗色变体、把 accent 从 sky blue `#4a90e2` 改成 indigo `#4f46e5`、重做首页 5 段结构、改造 site header / footer + chrome、最后应用新设计语言到其余 12 个公开页。

**Architecture:** 4 个独立 commit 串行执行。设计 token → 首页 → site chrome → 其他公开页。每 commit 自带验收门（typecheck ≤ 26、vitest 无新增失败、视觉烟测）。纯 Server Components（除 LookupForm / QuickTry / StatsBar 等现有 client 组件外）。不引入新 npm 依赖。

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 4 (token-only, no new classes), next-intl 4, next/font (5 Google Fonts), Prisma 5.22 (read-only)。

**Spec:** `docs/superpowers/specs/2026-09-10-public-pages-redesign-design.md` (commit `119b5e5`)

## Global Constraints

1. **Default theme rename**: `terminal` → `professional`. Old cookies carrying `ghc_theme=terminal` must keep working (treat as alias) — but new DEFAULT_THEME = 'professional'.
2. **Accent color**: indigo `#4f46e5` (indigo-600). Hover/active: `#4338ca` (indigo-700). Soft: `#eef2ff` (indigo-50). Dark-mode accent: `#818cf8` (indigo-400).
3. **Theme blocks**: keep all 3 (`terminal` / `editorial` / `brutalist`) CSS blocks for backward compat. Add a 4th block for `professional-dark`. Default `[data-theme="professional"]` styles inherit from the existing root tokens (no theme attribute = professional).
4. **No new npm deps**. CLAUDE.md 禁止。
5. **No API contract changes**. `/api/v1/*`, `/api/admin/*`, `/api/query/*` 不动。
6. **No prisma schema changes**. `prisma/schema.prisma` / `prisma/migrations/*` 不动。
7. **No breaking changes to existing i18n keys**. `messages/{en,zh}.json` 只新增 key，不删改。
8. **Quality gates per commit**:
   - `npm run typecheck` → errors ≤ 26 (baseline per M28 ledger)
   - `npm run lint` → no NEW violations in touched files
   - `npm test` → no NEW failures
   - Visual smoke: desktop (≥1024px) + tablet (640-1024px) + mobile (<640px) screenshots
   - Keyboard nav: Tab from logo → footer, no missing focus ring
   - `prefers-reduced-motion`: no fade-up / shimmer visible
9. **`ghc-*` class names do NOT change**. Only theme attribute values (`terminal` → `professional`) and CSS variable values change.
10. **Theme cookie**: `ghc_theme` cookie accepts values `professional` / `professional-dark` / `editorial` / `brutalist`. Old `terminal` cookies → treated as alias for `professional`.

---

## File Structure

**新建**：
- `src/app/_components/mobile-nav.tsx` — 汉堡菜单 + 抽屉（client component）
- `src/app/_components/account-menu.tsx` — 登录用户 dropdown（client component）
- `src/app/_components/uptime-bars.tsx` — `/status` 用 90 天条形图（client component）
- `src/app/_components/api-split.tsx` — 首页 API preview 双栏组件

**重写**：
- `src/app/globals.css` — token 调整（palette + typography + 新 professional-dark block）
- `src/app/page.tsx` — 首页打掉重盖（5 段 → 5 段新结构）
- `src/app/_components/site-header.tsx` — 删除 theme switcher、加 mobile nav、加 account menu
- `src/app/_components/site-footer.tsx` — live status dot

**修改**（轻量）：
- `src/lib/theme/themes.ts` — 加 `professional` / `professional-dark`，`DEFAULT_THEME = 'professional'`，`terminal` 保留为 alias
- `src/lib/theme/cookie.ts` — `resolveTheme` 接受 `terminal` 作为 `professional` 的 alias

**删除**：
- `src/app/_components/theme-switcher.tsx` — 删除整个文件

**测试新建**：
- `tests/unit/theme-resolve.test.ts` — `resolveTheme('terminal')` === `'professional'` 等
- `tests/unit/professional-dark.test.tsx` — 渲染时 `data-theme="professional-dark"` 切换

**文档**：
- `.superpowers/sdd/2026-09-10-public-pages-redesign/progress.md` — SDD ledger
- `docs/superpowers/specs/2026-09-10-public-pages-redesign-design.md` (already exists, commit `119b5e5`)
- `docs/superpowers/plans/2026-09-10-public-pages-redesign.md` (this file)

---

## Task 1: Design Token 调整 + Theme 重命名 + Theme Switcher 删除

**Files:**
- Modify: `src/app/globals.css` (palette tokens + professional-default block)
- Modify: `src/lib/theme/themes.ts` (add professional/professional-dark, keep terminal as alias)
- Modify: `src/lib/theme/cookie.ts` (no functional change, but verify resolveTheme handles alias)
- Delete: `src/app/_components/theme-switcher.tsx`
- Modify: `src/app/_components/site-header.tsx` (remove ThemeSwitcher import + usage)
- Create: `src/app/globals.css` professional-dark block
- Test: `tests/unit/theme-resolve.test.ts`

**Interfaces:**
- Consumes: existing THEME_IDS, DEFAULT_THEME constants; existing cookie resolution path
- Produces: `THEME_IDS` includes `'professional' | 'professional-dark' | 'editorial' | 'brutalist'`. `DEFAULT_THEME = 'professional'`. `resolveTheme('terminal')` returns `'professional'` (back-compat alias).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/theme-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTheme, DEFAULT_THEME, THEME_IDS, isThemeId } from '@/lib/theme/themes';

describe('theme-registry', () => {
  it('default is professional', () => {
    expect(DEFAULT_THEME).toBe('professional');
  });

  it('THEME_IDS includes professional and professional-dark', () => {
    expect(THEME_IDS).toContain('professional');
    expect(THEME_IDS).toContain('professional-dark');
    expect(THEME_IDS).toContain('editorial');
    expect(THEME_IDS).toContain('brutalist');
  });

  it('terminal is treated as professional alias for back-compat', () => {
    expect(resolveTheme('terminal')).toBe('professional');
  });

  it('professional and professional-dark resolve to themselves', () => {
    expect(resolveTheme('professional')).toBe('professional');
    expect(resolveTheme('professional-dark')).toBe('professional-dark');
  });

  it('unknown values fall back to DEFAULT_THEME', () => {
    expect(resolveTheme('nonsense')).toBe(DEFAULT_THEME);
    expect(resolveTheme(null)).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('isThemeId is type guard', () => {
    expect(isThemeId('professional')).toBe(true);
    expect(isThemeId('professional-dark')).toBe(true);
    expect(isThemeId('editorial')).toBe(true);
    expect(isThemeId('brutalist')).toBe(true);
    expect(isThemeId('terminal')).toBe(true); // alias still valid
    expect(isThemeId('nonsense')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/theme-resolve.test.ts`
Expected: FAIL — `DEFAULT_THEME` is `'terminal'` currently.

- [ ] **Step 3: Update theme registry to add professional**

Replace `src/lib/theme/themes.ts`:

```typescript
/**
 * Visual theme registry.
 *
 * Four themes: professional (light + dark variant) is the default;
 * editorial and brutalist are alt themes kept for back-compat.
 * The CSS file (`globals.css`) carries 4 `[data-theme="<id>"]` blocks.
 *
 * The `terminal` id is kept as an ALIAS for `professional` to honor
 * any existing cookies set before M29. Theme always resolves to one
 * of the 4 canonical ids — never to `terminal`.
 */

export const THEME_IDS = ['professional', 'professional-dark', 'editorial', 'brutalist'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

// Legacy alias — kept so old cookies (pre-M29) still work.
export const LEGACY_THEME_ALIASES: Record<string, ThemeId> = {
  terminal: 'professional',
};

export const DEFAULT_THEME: ThemeId = 'professional';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  shortLabel: string;
  blurb: string;
  /** Mood summary surfaced in admin settings copy. */
  mood: string;
  /** CSS var names for display + body + mono for this theme. */
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  professional: {
    id: 'professional',
    label: 'Professional',
    shortLabel: 'P',
    blurb: 'Light neutral / indigo accent',
    mood: 'Restrained professional — Linear / Vercel family.',
    fonts: {
      display: 'var(--font-sans)',
      body: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
  'professional-dark': {
    id: 'professional-dark',
    label: 'Professional (dark)',
    shortLabel: 'Pd',
    blurb: 'Dark zinc / indigo accent',
    mood: 'Restrained professional in dark — Linear dark family.',
    fonts: {
      display: 'var(--font-sans)',
      body: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    shortLabel: 'E',
    blurb: 'Light serif / newspaper',
    mood: 'Technical journal — serif headline, mono everywhere else.',
    fonts: {
      display: 'var(--font-serif)',
      body: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
  brutalist: {
    id: 'brutalist',
    label: 'Brutalist',
    shortLabel: 'B',
    blurb: 'Black / electric-blue / oversized',
    mood: 'Geometric, bold numbers, no decoration that does not serve the data.',
    fonts: {
      display: 'var(--font-display)',
      body: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  if (typeof value !== 'string') return false;
  if ((THEME_IDS as readonly string[]).includes(value)) return true;
  // Legacy alias accepted but not exposed via TypeScript narrowing.
  return value in LEGACY_THEME_ALIASES;
}

export function resolveTheme(value: unknown): ThemeId {
  if (typeof value === 'string') {
    if ((THEME_IDS as readonly string[]).includes(value)) return value as ThemeId;
    const alias = LEGACY_THEME_ALIASES[value];
    if (alias) return alias;
  }
  return DEFAULT_THEME;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/theme-resolve.test.ts`
Expected: PASS (6/6 tests)

- [ ] **Step 5: Update palette tokens in globals.css**

In `src/app/globals.css`, find the `:root` block (the design-token declarations — they currently set `--color-accent: #4a90e2` etc.) and replace with:

```css
:root {
  --color-bg: #fbfbfa;
  --color-surface: #ffffff;
  --color-surface-2: #f7f7f5;
  --color-ink: #18181b;
  --color-ink-muted: #71717a;
  --color-rule: #e4e4e7;
  --color-accent: #4f46e5;
  --color-accent-deep: #4338ca;
  --color-accent-soft: #eef2ff;
  --color-accent-ink: #ffffff;
  --color-warn: #b45309;
  --color-danger: #b91c1c;

  --font-display: 'IBM Plex Sans', system-ui, sans-serif;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --font-serif: 'Fraunces', Georgia, serif;

  --text-display-xl: 3.5rem;
  --text-display-lg: 2.5rem;
  --text-display-md: 1.875rem;
  --text-display-sm: 1.5rem;
  --text-body-lg: 1.125rem;
  --text-body: 1rem;
  --text-caption: 0.875rem;
  --text-eyebrow: 0.75rem;

  --space-section: clamp(3rem, 6vw, 5rem);
}
```

(The `--color-accent-ink` token may already exist; if so, leave it.)

- [ ] **Step 6: Add `[data-theme="professional-dark"]` block to globals.css**

Find the existing `[data-theme="terminal"]` block in `src/app/globals.css` (it overrides root tokens with dark IDE-style colors). Rename it to `[data-theme="professional-dark"]` and update the token values to zinc-950 / zinc-900 / indigo-400 family per spec §2.1:

```css
[data-theme="professional-dark"] {
  --color-bg: #09090b;
  --color-surface: #18181b;
  --color-surface-2: #27272a;
  --color-ink: #fafafa;
  --color-ink-muted: #a1a1aa;
  --color-rule: #27272a;
  --color-accent: #818cf8;
  --color-accent-deep: #6366f1;
  --color-accent-soft: #1e1b4b;
  --color-warn: #fbbf24;
  --color-danger: #f87171;
}
```

If the original block had font overrides, drop them — `professional-dark` uses the same fonts as `professional`.

- [ ] **Step 7: Verify the `professional` default uses root tokens**

Verify (read-only — no edit): the existing `[data-theme="professional"]` block does not exist yet — the `:root` block IS the default. If an empty `[data-theme="professional"] { }` block already exists, leave it; if not, do not add one. (Root tokens ARE the professional theme.)

- [ ] **Step 8: Delete `src/app/_components/theme-switcher.tsx`**

Run: `rm src/app/_components/theme-switcher.tsx`

- [ ] **Step 9: Remove ThemeSwitcher from site-header**

In `src/app/_components/site-header.tsx`:
- Delete `import { ThemeSwitcher } from '@/app/_components/theme-switcher';`
- Delete the `<ThemeSwitcher current={currentTheme} />` line in the `<nav>` block
- Keep the `readThemeFromCookieHeader(cookieHeader)` call — `site-header.tsx` still needs to know the theme so it can pass `data-theme` to `<html>` via `layout.tsx` (this happens via `layout.tsx`, not here; so remove the `currentTheme` variable too if not used elsewhere)
- Verify: the only use of `currentTheme` was ThemeSwitcher; if so, remove `const currentTheme = readThemeFromCookieHeader(cookieHeader);`

- [ ] **Step 10: Run quality gates**

```bash
npm run typecheck
npm run lint
npm test -- tests/unit/theme-resolve.test.ts
```

Expected:
- typecheck: errors ≤ 26
- lint: no new errors in touched files
- test: 6/6 pass

- [ ] **Step 11: Manual smoke test**

1. `npm run dev:server` (or `npm run dev`)
2. Open `http://localhost:5002/`
3. Open DevTools → Application → Cookies → set `ghc_theme=professional` → reload → page background should be light off-white (#fbfbfa), accent should be indigo
4. Set `ghc_theme=professional-dark` → reload → page background should be zinc-950 dark, accent should be indigo-400
5. Set `ghc_theme=terminal` (old cookie) → reload → should resolve to professional (no flash)
6. Set `ghc_theme=editorial` → reload → serif headline theme
7. Set `ghc_theme=brutalist` → reload → oversized geometric theme

- [ ] **Step 12: Commit**

```bash
git add src/lib/theme/themes.ts src/lib/theme/cookie.ts src/app/globals.css src/app/_components/site-header.tsx tests/unit/theme-resolve.test.ts
git rm src/app/_components/theme-switcher.tsx
git commit -m "chore(design-tokens): rename terminal->professional, add professional-dark, indigo accent

- Add 'professional' and 'professional-dark' as new default themes
- Keep 'terminal' as legacy alias resolving to 'professional' (back-compat)
- Replace sky-blue accent (#4a90e2) with indigo (#4f46e5)
- Update :root palette to low-saturation neutral grays
- Add dark-mode palette (zinc-950 + indigo-400 accent)
- Delete theme-switcher.tsx (public surface no longer offers theme switching)
- Update site-header.tsx to remove ThemeSwitcher import/usage
- Add tests/unit/theme-resolve.test.ts (6 tests)"
```

---

## Task 2: 首页重做（打掉重盖）

**Files:**
- Modify: `src/app/page.tsx` (full rewrite — 5 section structure)
- Create: `src/app/_components/hero-section.tsx` (extracted hero)
- Create: `src/app/_components/api-split.tsx` (curl + JSON side-by-side)
- Modify: `src/app/_components/lookup-form.tsx` (new max-w-640 layout, removed card gradient)
- Modify: `src/app/_components/quick-try.tsx` (horizontal pill buttons under lookup)
- Modify: `src/app/_components/stats-bar.tsx` (4 cells, mobile 2-col)
- Modify: `src/app/_components/features-section.tsx` (3-up grid → 3-up grid, refined icons)
- Modify: `src/app/_components/recent-lookups-list.tsx` (4-col desktop / 2-col mobile)
- Modify: `src/app/_components/api-doc-section.tsx` (replace with import of api-split OR delete — see step 8)
- Modify: `src/app/_components/how-it-works.tsx` (delete OR keep — see step 9)
- Modify: `src/app/globals.css` (new ghc-* classes for new layout, if needed)

**Interfaces:**
- Consumes: existing `recentLookups(8)` from `@/lib/db/repositories`, existing `lookupAction`, existing `ghc-*` classes
- Produces: new `HeroSection`, `ApiSplit` exported components

- [ ] **Step 1: Create `hero-section.tsx`**

Create `src/app/_components/hero-section.tsx`:

```tsx
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { LookupForm } from './lookup-form';
import { QuickTry } from './quick-try';

/**
 * Hero section: eyebrow + h1 + tagline + centered lookup form + quick-try row.
 * Pure server component (form is client — lookup is via server action).
 */
export async function HeroSection(): Promise<ReactElement> {
  const t = await getTranslations('home');
  return (
    <section className="ghc-hero">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
        <div className="ghc-eyebrow mb-4 inline-flex items-center gap-2 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          {t('hero.eyebrow')}
        </div>
        <h1 className="ghc-display-heading">{t('hero.title')}</h1>
        <p className="ghc-hero-tagline">{t('hero.tagline')}</p>
        <div className="mx-auto mt-8 max-w-[640px]">
          <LookupForm />
        </div>
        <div className="mt-6">
          <QuickTry />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `api-split.tsx`**

Create `src/app/_components/api-split.tsx`:

```tsx
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * Side-by-side API preview: curl request on left, trimmed JSON response on right.
 * Server component. Code blocks use ghc-code-block for monospace + light bg.
 */
export async function ApiSplit(): Promise<ReactElement> {
  const t = await getTranslations('home.apiPreview');
  const curlCmd = `curl https://api.githubcache.dev/api/v1/repos/facebook/react`;
  const responseJson = `{
  "owner": "facebook",
  "name": "react",
  "stars": 234567,
  "forks": 49000,
  "language": "JavaScript",
  "license": "MIT",
  "topics": ["frontend", "ui"],
  "cached_at": "2026-09-10T12:00:00Z"
}`;

  return (
    <section className="ghc-api-split" data-testid="ghc-api-split">
      <div className="ghc-section-eyebrow">{t('eyebrow')}</div>
      <h2 className="ghc-section-heading">{t('heading')}</h2>
      <div className="ghc-api-split-grid">
        <div className="ghc-code-block">
          <div className="ghc-code-block-label">{t('request')}</div>
          <pre className="ghc-code-block-content"><code>{curlCmd}</code></pre>
        </div>
        <div className="ghc-code-block">
          <div className="ghc-code-block-label">{t('response')}</div>
          <pre className="ghc-code-block-content"><code>{responseJson}</code></pre>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Rewrite `lookup-form.tsx` layout**

Modify `src/app/_components/lookup-form.tsx`:
- Remove the wrapper `<div className="ghc-card ghc-fade-up p-6 shadow-lg sm:p-8">` (no longer wraps the form — hero section handles spacing)
- Replace it with just the `<form>` and error/result blocks

The new structure:

```tsx
'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { lookupAction, type LookupFormState } from '@/app/_actions/lookup';
import { LookupResultCard } from './lookup-result-card';
import { SubmitButton } from './submit-button';

const initialState: LookupFormState = { status: 'idle' };

export function LookupForm() {
  const t = useTranslations('home.lookup.form');
  const [state, formAction] = useActionState(lookupAction, initialState);

  return (
    <>
      <form
        action={formAction}
        className="ghc-lookup-form"
        aria-label={t('ariaLabel')}
      >
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="ghc-eyebrow">{t('ownerLabel')}</span>
          <input
            type="text"
            name="owner"
            placeholder={t('ownerPlaceholder')}
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-input"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="ghc-eyebrow">{t('repoLabel')}</span>
          <input
            type="text"
            name="name"
            placeholder={t('repoPlaceholder')}
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-input"
          />
        </label>
        <div className="flex">
          <SubmitButton />
        </div>
      </form>

      {state.status === 'invalid' && (
        <div role="alert" className="ghc-alert ghc-alert-danger ghc-fade-up mt-5">
          {/* SVG icon + message — same as before */}
        </div>
      )}
      {state.status === 'rate_limited' && (
        <div role="alert" className="ghc-alert ghc-alert-warn ghc-fade-up mt-5">
          {/* SVG icon + message */}
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" className="ghc-alert ghc-alert-danger ghc-fade-up mt-5">
          {/* SVG icon + message */}
        </div>
      )}
      {state.status === 'ok' && state.result && <LookupResultCard result={state.result} />}
    </>
  );
}
```

Keep the existing SVG icons in the three error blocks verbatim. The change is just: extract the form out of the card wrapper into a `<>` fragment, add `ghc-lookup-form` class on `<form>`.

- [ ] **Step 4: Update `quick-try.tsx`**

Modify `src/app/_components/quick-try.tsx`:
- Change `<section>` to a `<div>` (the sectioning is now done by hero)
- Add inline label text "Try:" before the buttons
- Keep button logic unchanged

```tsx
'use client';

import { useTransition, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAction, type LookupFormState } from '@/app/_actions/lookup';

interface QuickRepo {
  owner: string;
  name: string;
  blurb: string;
}

const QUICK_REPOS: QuickRepo[] = [
  { owner: 'torvalds', name: 'linux', blurb: 'the kernel' },
  { owner: 'microsoft', name: 'vscode', blurb: 'editor' },
  { owner: 'vitejs', name: 'vite', blurb: 'build tool' },
];

export function QuickTry(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function tryOne(repo: QuickRepo): void {
    const fd = new FormData();
    fd.set('owner', repo.owner);
    fd.set('name', repo.name);
    startTransition(async () => {
      const state: LookupFormState = await lookupAction(
        { status: 'idle' },
        fd,
      );
      if (state.status === 'ok' && state.result?.canonical) {
        const [owner, name] = state.result.canonical.split('/');
        if (owner && name) router.push(`/repo/${owner}/${name}`);
      }
    });
  }

  return (
    <div className="ghc-quick-try" data-testid="ghc-quick-try">
      <div className="ghc-quick-try-label">Try:</div>
      <div className="ghc-quick-try-buttons">
        {QUICK_REPOS.map((r) => (
          <button
            key={`${r.owner}/${r.name}`}
            type="button"
            className="ghc-quick-try-btn"
            disabled={pending}
            onClick={() => tryOne(r)}
          >
            <span className="ghc-quick-try-owner">{r.owner}/</span>
            <span className="ghc-quick-try-name">{r.name}</span>
            <span className="ghc-quick-try-blurb">— {r.blurb}</span>
          </button>
        ))}
      </div>
      {pending ? (
        <p className="ghc-quick-try-pending">Looking up…</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify `stats-bar.tsx` responsive grid**

Open `src/app/_components/stats-bar.tsx`. Verify it uses `ghc-stats-bar` class. No code change needed if the class already does responsive grid; if not, add `grid-cols-2 lg:grid-cols-4` to the className in the existing `<section>`.

- [ ] **Step 6: Verify `features-section.tsx` 3-up grid**

Open `src/app/_components/features-section.tsx`. Verify `ghc-features-grid` is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. No change if so.

- [ ] **Step 7: Verify `recent-lookups-list.tsx` responsive grid**

Open `src/app/_components/recent-lookups-list.tsx`. Find the `<ul className="grid ...">`. Change `lg:grid-cols-3` to `lg:grid-cols-4` (and `sm:grid-cols-2` stays).

- [ ] **Step 8: Replace api-doc-section usage with api-split**

In `src/app/page.tsx`, after rewriting it (next step), replace the `<ApiDocSection />` import with `import { ApiSplit } from './_components/api-split'` and render `<ApiSplit />` in its place.

Then delete `src/app/_components/api-doc-section.tsx` (or keep it for reuse in `/docs/api/get-repo` — verify no other import; if no other usage, delete).

Run: `grep -r "api-doc-section" src/`
Expected (if no other usage): only the import in old page.tsx. Delete the file:
Run: `rm src/app/_components/api-doc-section.tsx`

- [ ] **Step 9: Decide on how-it-works**

`HowItWorks` exists as a 3-step visual flow. The new homepage structure drops it (Hero / Stats / Features / API / Recent). Remove from page.tsx imports + render. Delete `src/app/_components/how-it-works.tsx` if no other usage:

Run: `grep -r "how-it-works" src/`
Expected: only page.tsx. Delete:
Run: `rm src/app/_components/how-it-works.tsx`

- [ ] **Step 10: Rewrite `src/app/page.tsx`**

Replace `src/app/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { recentLookups } from '@/lib/db/repositories';
import { HeroSection } from './_components/hero-section';
import { StatsBar } from './_components/stats-bar';
import { FeaturesSection } from './_components/features-section';
import { ApiSplit } from './_components/api-split';
import { RecentLookupsList } from './_components/recent-lookups-list';
import { SiteFooter } from './_components/site-footer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('home.meta');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function HomePage() {
  const t = await getTranslations('home');
  const recent = await recentLookups(8);
  // SiteFooter is async (uses getTranslations) — await it before embedding
  // in JSX so non-RSC renderers can resolve it.
  const footer = await SiteFooter();
  return (
    <main>
      {/* Hero — eyebrow + h1 + tagline + lookup form + quick-try */}
      <HeroSection />

      {/* Stats strip — live counts from /api/v1/status */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <StatsBar />
        </div>
      </section>

      {/* Features — 3-up grid */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <FeaturesSection />
        </div>
      </section>

      {/* API preview — split panel */}
      <section className="ghc-section">
        <div className="mx-auto max-w-6xl px-4">
          <ApiSplit />
        </div>
      </section>

      {/* Recent lookups */}
      <section className="ghc-section ghc-section-last">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">{t('recent.heading')}</h2>
            <span className="text-sm text-[color:var(--color-ink-muted)]">
              {t('recent.countCached', { count: recent.length })}
            </span>
          </div>
          <RecentLookupsList repos={recent} />
        </div>
      </section>

      {/* Footer */}
      {footer}
    </main>
  );
}
```

- [ ] **Step 11: Add new i18n keys**

In `messages/en.json` and `messages/zh.json`, find the `home` namespace. Add:

```json
"apiPreview": {
  "eyebrow": "API",
  "heading": "One endpoint. One JSON response.",
  "request": "Request",
  "response": "Response"
}
```

(zh translation: `"API"`, `"一个端点。一个 JSON 响应。"`, `"请求"`, `"响应"`)

Verify no existing key clashes by reading the relevant namespace slice before adding. Do NOT modify existing keys.

- [ ] **Step 12: Add new CSS classes to globals.css**

In `src/app/globals.css`, inside the `@layer components` block (find it), add:

```css
@layer components {
  /* Hero */
  .ghc-hero { background: var(--color-bg); }
  .ghc-display-heading {
    font-family: var(--font-sans);
    font-size: var(--text-display-xl);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--color-ink);
  }
  @media (max-width: 640px) {
    .ghc-display-heading { font-size: 2.25rem; }
  }
  .ghc-hero-tagline {
    margin-left: auto;
    margin-right: auto;
    margin-top: 1rem;
    max-width: 42rem;
    color: var(--color-ink-muted);
    font-size: var(--text-body-lg);
    line-height: 1.6;
  }
  .ghc-lookup-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  @media (min-width: 640px) {
    .ghc-lookup-form { flex-direction: row; align-items: end; }
  }

  /* Section spacing */
  .ghc-section { padding-block: var(--space-section); }
  .ghc-section-last { padding-bottom: calc(var(--space-section) + 2rem); }

  /* API split */
  .ghc-api-split { }
  .ghc-api-split-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 768px) {
    .ghc-api-split-grid { grid-template-columns: 1fr 1fr; }
  }
  .ghc-code-block {
    background: var(--color-surface-2);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    overflow: hidden;
  }
  .ghc-code-block-label {
    padding: 0.5rem 0.75rem;
    font-size: var(--text-eyebrow);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-ink-muted);
    border-bottom: 1px solid var(--color-rule);
  }
  .ghc-code-block-content {
    margin: 0;
    padding: 1rem;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--color-ink);
    overflow-x: auto;
    white-space: pre;
  }

  /* Quick try */
  .ghc-quick-try {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    font-size: var(--text-caption);
    color: var(--color-ink-muted);
  }
  .ghc-quick-try-label { font-weight: 500; }
  .ghc-quick-try-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Recent lookups grid override */
  .ghc-recent-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 640px) { .ghc-recent-grid { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1024px) { .ghc-recent-grid { grid-template-columns: repeat(4, 1fr); } }
}
```

- [ ] **Step 13: Use ghc-recent-grid in recent-lookups-list.tsx**

In `src/app/_components/recent-lookups-list.tsx`, change the `<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">` to `<ul className="ghc-recent-grid">`.

- [ ] **Step 14: Run quality gates**

```bash
npm run typecheck
npm run lint
npm test
```

Expected:
- typecheck: errors ≤ 26 (same as baseline)
- lint: no new errors
- test: 6/6 from Task 1 still pass; no NEW failures

- [ ] **Step 15: Manual smoke test**

1. `npm run dev:server`
2. Open `http://localhost:5002/`
3. Verify: hero has eyebrow / h1 / tagline / lookup form / quick-try
4. Verify: stats bar shows 4 cells with numbers
5. Verify: features section 3-up
6. Verify: API preview split panel (curl + JSON)
7. Verify: recent lookups 4-col desktop, 2-col mobile (resize)
8. Keyboard Tab from logo: should reach lookup form input, then Submit, then quick-try buttons
9. Verify indigo accent: hover on "Lookup →" button should turn indigo-700
10. Lighthouse local build: LCP < 1.5s (only required if lighthouse is installed; if not, skip)

- [ ] **Step 16: Commit**

```bash
git add src/app/page.tsx src/app/_components/hero-section.tsx src/app/_components/api-split.tsx src/app/_components/lookup-form.tsx src/app/_components/quick-try.tsx src/app/_components/recent-lookups-list.tsx src/app/globals.css messages/en.json messages/zh.json
git rm src/app/_components/api-doc-section.tsx src/app/_components/how-it-works.tsx
git commit -m "feat(homepage): visual rebuild — 5-section restrained-professional structure

- New HeroSection (eyebrow + h1 + tagline + centered form + quick-try)
- New ApiSplit (curl + JSON side-by-side)
- Rewrite page.tsx with 5 sections: hero / stats / features / api / recent
- Extract LookupForm out of card wrapper (form gets its own card)
- Recent lookups: 4-col desktop / 2-col mobile (was 3-col / 2-col)
- Add i18n keys home.apiPreview (en + zh)
- New CSS: ghc-display-heading, ghc-hero-tagline, ghc-lookup-form,
  ghc-section, ghc-code-block, ghc-api-split-grid, ghc-quick-try,
  ghc-recent-grid
- Delete unused: api-doc-section, how-it-works"
```

---

## Task 3: Site Chrome（site-header + site-footer + mobile-nav + account-menu）

**Files:**
- Modify: `src/app/_components/site-header.tsx` (remove theme switcher already done; add mobile-nav + account-menu; new layout)
- Modify: `src/app/_components/site-footer.tsx` (live status dot + restructure)
- Create: `src/app/_components/mobile-nav.tsx` (hamburger + drawer)
- Create: `src/app/_components/account-menu.tsx` (avatar + dropdown)
- Modify: `src/app/globals.css` (mobile-nav drawer styles, footer live status styles)

**Interfaces:**
- Consumes: `validateSession({ headers, cookies })` from `@/lib/auth/session`, existing `LangSwitcher`, existing `SITE_NAME`
- Produces: `<MobileNav links={...} isLoggedIn={...} />`, `<AccountMenu email={...} role={...} />`

- [ ] **Step 1: Create `mobile-nav.tsx`**

Create `src/app/_components/mobile-nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useState, type JSX } from 'react';
import { useTranslations } from 'next-intl';

interface NavLink {
  href: string;
  label: string;
  ariaLabel?: string;
}

interface Props {
  links: NavLink[];
  accountLabel: string;
  accountHref: string;
  loggedInLabel: string;
}

/**
 * Hamburger menu for screens < 1024px. Drawer-style overlay.
 * Server side renders nothing (returns null) when the layout is
 * hidden via CSS — hamburger is mobile-only via @media.
 */
export function MobileNav({ links, accountLabel, accountHref, loggedInLabel }: Props): JSX.Element {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="ghc-hamburger"
        aria-label={t('mobileMenuAria')}
        aria-expanded={open}
        aria-controls="ghc-mobile-nav-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open ? (
        <div
          className="ghc-mobile-nav-drawer"
          id="ghc-mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('mobileMenuAria')}
        >
          <nav className="ghc-mobile-nav-links">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="ghc-mobile-nav-link"
                aria-label={l.ariaLabel}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            ))}
            <Link
              href={accountHref}
              className="ghc-mobile-nav-link"
              onClick={() => setOpen(false)}
            >
              {accountLabel}
            </Link>
          </nav>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Create `account-menu.tsx`**

Create `src/app/_components/account-menu.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useState, useRef, useEffect, type JSX } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  email: string;
  isAdmin: boolean;
  logoutHref: string;
}

/**
 * Avatar + email-initial trigger; dropdown shows account links + logout.
 * Closes on outside click + Escape key.
 */
export function AccountMenu({ email, isAdmin, logoutHref }: Props): JSX.Element {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = email.charAt(0).toUpperCase() || '?';

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }
  }, [open]);

  return (
    <div className="ghc-account-menu" ref={ref}>
      <button
        type="button"
        className="ghc-account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('accountMenuAria', { email })}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ghc-account-avatar" aria-hidden="true">{initial}</span>
      </button>
      {open ? (
        <div className="ghc-account-menu-dropdown" role="menu">
          <Link href="/account" className="ghc-account-menu-item" role="menuitem">
            {t('account')}
          </Link>
          <Link href="/account/keys" className="ghc-account-menu-item" role="menuitem">
            {t('apiKeys')}
          </Link>
          {isAdmin ? (
            <Link href="/admin" className="ghc-account-menu-item" role="menuitem">
              {t('admin')}
            </Link>
          ) : null}
          <Link href="/account/preferences" className="ghc-account-menu-item" role="menuitem">
            {t('preferences')}
          </Link>
          <hr className="ghc-account-menu-sep" />
          <a href={logoutHref} className="ghc-account-menu-item ghc-account-menu-logout" role="menuitem">
            {t('logout')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `site-header.tsx`**

Replace `src/app/_components/site-header.tsx`:

```tsx
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { LangSwitcher } from '@/app/_components/lang-switcher';
import { TimezoneSwitcher } from '@/app/_components/timezone-switcher';
import { readLangFromCookieHeader } from '@/lib/lang/cookie';
import { readTimezoneFromCookieHeader } from '@/lib/timezone/cookie';
import { resolveLocale, LOCALES } from '@/lib/lang/registry';
import { SITE_NAME } from '@/lib/config/site';
import { validateSession } from '@/lib/auth/session';
import { MobileNav } from './mobile-nav';
import { AccountMenu } from './account-menu';

/**
 * Top navigation bar. Sticky, theme-aware.
 *
 * Layout:
 *   - left:  logo
 *   - middle (≥ 1024px): nav links (Lookup / Docs / Status)
 *   - right (≥ 1024px): TZ / Lang / Login | AccountMenu
 *   - < 1024px: MobileNav hamburger on the right
 *
 * Pure server component; reads cookies + session once, passes primitives
 * down to the (client) MobileNav + AccountMenu.
 */
export async function SiteHeader() {
  const headerStore = await headers();
  const cookieHeader = headerStore.get('cookie') ?? null;
  const currentLang = resolveLocale({
    cookieValue: readLangFromCookieHeader(cookieHeader),
    acceptLanguage: headerStore.get('accept-language'),
  });
  const currentTimezone = readTimezoneFromCookieHeader(cookieHeader);
  const t = await getTranslations('nav');

  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const session = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  const isAdmin = session?.role === 'admin';
  const isLoggedIn = session !== null;
  const userEmail = session?.email ?? '';

  const navLinks = [
    { href: '/get-started', label: t('apiGuide'), ariaLabel: t('apiGuideAria') },
    { href: '/status', label: t('status'), ariaLabel: t('statusAria') },
  ];

  return (
    <header className="ghc-site-header sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </span>
          <span className="text-base">{SITE_NAME}</span>
        </Link>

        {/* Desktop nav (≥ 1024px) */}
        <nav className="ghc-desktop-nav">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="ghc-header-util-link" aria-label={l.ariaLabel}>
              {l.label}
            </Link>
          ))}
          <TimezoneSwitcher current={currentTimezone} />
          <LangSwitcher current={currentLang} locales={LOCALES} />
          {isLoggedIn ? (
            <AccountMenu email={userEmail} isAdmin={isAdmin} logoutHref="/api/auth/logout" />
          ) : (
            <Link href="/login" className="ghc-btn-secondary ghc-btn-sm">
              {t('login')}
            </Link>
          )}
        </nav>

        {/* Mobile nav (< 1024px) */}
        <MobileNav
          links={navLinks}
          accountLabel={isLoggedIn ? t('account') : t('login')}
          accountHref={isLoggedIn ? '/account' : '/login'}
          loggedInLabel={t('login')}
        />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Rewrite `site-footer.tsx` with live status**

Replace `src/app/_components/site-footer.tsx`:

```tsx
import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import packageJson from '../../../package.json';
import { SITE_NAME } from '@/lib/config/site';
import { fetchStatusPing } from '@/lib/status/ping';

const VERSION = packageJson.version;

/**
 * Site footer: brand+tagline / nav links / live API status dot.
 * Reads version from package.json at build time (Next.js inlines it).
 *
 * Server component — fetches a small status snapshot for the live dot.
 */
export async function SiteFooter(): Promise<ReactElement> {
  const tNav = await getTranslations('nav');
  const tFoot = await getTranslations('footer');
  const ping = await fetchStatusPing();

  return (
    <footer className="ghc-site-footer" data-testid="ghc-site-footer">
      <div className="ghc-site-footer-grid">
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-brand">{SITE_NAME}</p>
          <p className="ghc-site-footer-tagline">{tFoot('tagline')}</p>
        </div>
        <div className="ghc-site-footer-col">
          <p className="ghc-site-footer-heading">{tFoot('explore')}</p>
          <ul className="ghc-site-footer-list">
            <li><Link href="/get-started" className="ghc-link">{tNav('apiGuide')}</Link></li>
            <li><Link href="/status" className="ghc-link">{tNav('status')}</Link></li>
            <li><Link href="/account" className="ghc-link">{tNav('account')}</Link></li>
            <li><Link href="/login" className="ghc-link">{tNav('login')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="ghc-site-footer-fine">
        <span>© {new Date().getUTCFullYear()} {SITE_NAME}</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span>MIT</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span>v{VERSION}</span>
        <span className="ghc-site-footer-fine-sep">·</span>
        <a
          href="https://github.com/fogyisland/githubcache"
          className="ghc-link"
          target="_blank"
          rel="noreferrer noopener"
        >
          GitHub
        </a>
        <span className="ghc-site-footer-fine-sep">·</span>
        <span className="ghc-site-footer-status">
          <span
            className="ghc-status-dot"
            data-state={ping.ok ? 'ok' : 'fail'}
            aria-hidden="true"
          />
          {ping.ok ? tFoot('statusOk') : tFoot('statusDown')}
          <span className="sr-only">{ping.ok ? tFoot('statusOkSr') : tFoot('statusDownSr')}</span>
        </span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Create `src/lib/status/ping.ts`**

Create `src/lib/status/ping.ts`:

```typescript
/**
 * Lightweight status snapshot for the site-footer live dot. Cached 60s
 * to avoid hammering /api/v1/status from every page render.
 */
import { unstable_cache } from 'next/cache';

export interface StatusPing {
  ok: boolean;
}

export const fetchStatusPing = unstable_cache(
  async (): Promise<StatusPing> => {
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:5002'}/api/v1/status`,
        { cache: 'no-store' },
      );
      return { ok: r.ok };
    } catch {
      return { ok: false };
    }
  },
  ['site-footer-status-ping'],
  { revalidate: 60 },
);
```

- [ ] **Step 6: Add new i18n keys (nav + footer)**

In `messages/en.json` (and zh.json):

For `nav` namespace, ADD (do not modify existing keys):
```json
"mobileMenuAria": "Open menu",
"accountMenuAria": "Account menu for {email}",
"apiGuideAria": "API usage guide",
"apiKeys": "API keys",
"preferences": "Preferences",
"logout": "Log out"
```

For `footer` namespace, ADD:
```json
"explore": "Explore",
"statusOk": "API operational",
"statusOkSr": "All systems operational",
"statusDown": "API degraded",
"statusDownSr": "API is reporting issues"
```

(zh translations: `"打开菜单"`, `"账户菜单 {email}"`, `"API 使用指南"`, `"API 密钥"`, `"偏好设置"`, `"登出"`, `"浏览"`, `"API 正常"`, `"所有系统正常"`, `"API 异常"`, `"API 正在报错"`)

Verify no existing key clashes before adding.

- [ ] **Step 7: Add new CSS classes to globals.css**

In `src/app/globals.css`, inside `@layer components`, add:

```css
@layer components {
  /* Desktop nav — hidden on mobile */
  .ghc-desktop-nav {
    display: none;
    align-items: center;
    gap: 0.75rem;
  }
  @media (min-width: 1024px) {
    .ghc-desktop-nav { display: flex; }
  }

  /* Hamburger — visible only < 1024px */
  .ghc-hamburger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--color-rule);
    border-radius: 4px;
    background: var(--color-surface);
    color: var(--color-ink);
    cursor: pointer;
  }
  .ghc-hamburger:hover { border-color: var(--color-accent); }
  .ghc-hamburger:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (min-width: 1024px) {
    .ghc-hamburger { display: none; }
  }

  /* Mobile drawer */
  .ghc-mobile-nav-drawer {
    position: fixed;
    inset: 3.5rem 0 0 0;
    background: var(--color-surface);
    border-top: 1px solid var(--color-rule);
    z-index: 30;
    padding: 1.5rem 1rem;
  }
  .ghc-mobile-nav-links {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .ghc-mobile-nav-link {
    display: block;
    padding: 0.75rem 0.5rem;
    font-size: 1rem;
    color: var(--color-ink);
    border-radius: 4px;
  }
  .ghc-mobile-nav-link:hover { background: var(--color-surface-2); }

  /* Account menu */
  .ghc-account-menu { position: relative; }
  .ghc-account-menu-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--color-rule);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-ink);
    cursor: pointer;
  }
  .ghc-account-menu-trigger:hover { border-color: var(--color-accent); }
  .ghc-account-menu-trigger:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .ghc-account-avatar {
    font-size: 0.875rem;
    font-weight: 600;
  }
  .ghc-account-menu-dropdown {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 12rem;
    background: var(--color-surface);
    border: 1px solid var(--color-rule);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    padding: 0.25rem;
    z-index: 50;
  }
  .ghc-account-menu-item {
    display: block;
    padding: 0.5rem 0.75rem;
    font-size: var(--text-caption);
    color: var(--color-ink);
    border-radius: 4px;
    text-decoration: none;
  }
  .ghc-account-menu-item:hover { background: var(--color-surface-2); }
  .ghc-account-menu-sep {
    border: none;
    border-top: 1px solid var(--color-rule);
    margin: 0.25rem 0;
  }
  .ghc-account-menu-logout { color: var(--color-danger); }

  /* Site footer */
  .ghc-site-footer-grid {
    display: grid;
    gap: 2rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 1024px) {
    .ghc-site-footer-grid { grid-template-columns: 2fr 1fr; }
  }
  .ghc-site-footer-fine {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-rule);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--text-caption);
    color: var(--color-ink-muted);
  }
  .ghc-site-footer-fine-sep { color: var(--color-rule); }
  .ghc-site-footer-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .ghc-status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--color-ink-muted);
  }
  .ghc-status-dot[data-state="ok"] { background: #16a34a; }
  .ghc-status-dot[data-state="fail"] { background: var(--color-danger); }
}
```

- [ ] **Step 8: Run quality gates**

```bash
npm run typecheck
npm run lint
npm test
```

Expected:
- typecheck: errors ≤ 26 (no regression)
- lint: no new errors in touched files
- test: 6/6 from Task 1 + Task 2 still pass

- [ ] **Step 9: Manual smoke test**

1. `npm run dev:server`
2. Open `http://localhost:5002/` at ≥ 1024px viewport
3. Verify: header shows logo + nav links (api-guide / status) + TZ + Lang + (Login OR AccountMenu)
4. Resize to < 1024px: hamburger appears, desktop nav hidden
5. Click hamburger: nav links slide down as drawer
6. Tab through drawer links: should reach all
7. Click outside drawer: closes
8. Resize back to desktop: hamburger hidden, desktop nav visible
9. Logged-in: avatar shows initial; click → dropdown with Account / API keys / (Admin) / Preferences / Logout
10. Click outside dropdown: closes
11. Press Escape on dropdown: closes
12. Footer: live status dot present; if /api/v1/status returns 200, dot is green
13. Keyboard Tab from logo: should reach every interactive element with visible focus ring

- [ ] **Step 10: Commit**

```bash
git add src/app/_components/site-header.tsx src/app/_components/site-footer.tsx src/app/_components/mobile-nav.tsx src/app/_components/account-menu.tsx src/lib/status/ping.ts src/app/globals.css messages/en.json messages/zh.json
git commit -m "feat(site-chrome): header (no theme switcher) + footer (live status) + mobile-nav + account-menu

- Site-header: remove theme switcher; add mobile nav (<1024px) and
  account menu (logged-in users)
- Site-footer: restructure (brand + nav col); add live API status dot
  (green/red via /api/v1/status, cached 60s)
- New MobileNav: hamburger + drawer dialog with role=dialog aria-modal
- New AccountMenu: avatar + dropdown (Account / API keys / Admin if
  admin / Preferences / Logout); outside-click + Escape closes
- New lib/status/ping.ts: cached status snapshot for footer dot
- New CSS: ghc-desktop-nav, ghc-hamburger, ghc-mobile-nav-drawer,
  ghc-account-menu, ghc-site-footer-grid, ghc-site-footer-fine,
  ghc-status-dot
- New i18n keys: nav.mobileMenuAria / accountMenuAria / apiGuideAria /
  apiKeys / preferences / logout; footer.explore / statusOk / statusDown"
```

---

## Task 4: 其他 12 个公开页应用新设计语言

**Files:**
- Modify: 12 page files (per spec §3.4 table) — verify each uses `professional` theme, no `terminal` string literals, applies new `ghc-*` classes where relevant
- Modify: `src/app/login/page.tsx`, `src/app/login/_login-form.tsx`
- Modify: `src/app/status/page.tsx`
- Modify: `src/app/get-started/page.tsx`
- Modify: `src/app/repo/[owner]/[name]/page.tsx`
- Modify: `src/app/account/page.tsx`, `src/app/account/layout.tsx`
- Modify: `src/app/account/keys/page.tsx`, `src/app/account/keys/[id]/page.tsx`
- Modify: `src/app/account/keys/request/page.tsx`
- Modify: `src/app/account/password/page.tsx`
- Modify: `src/app/docs/page.tsx`, `src/app/docs/layout.tsx`, `src/app/docs/api/[slug]/page.tsx` (template)
- Modify: `src/app/init/page.tsx`, `src/app/init/*` pages

**Interfaces:**
- Consumes: existing `ghc-*` class library (extended by Tasks 1-3); existing pages + i18n
- Produces: each page applies `data-theme="professional"` (or relies on root default), uses new `ghc-*` classes, no `terminal` literals

- [ ] **Step 1: Audit each page for `terminal` literals**

For each of the 12 pages, search:
- `grep -l "terminal" src/app/<page>/`
- If found, decide whether the literal is theme-related (must replace with `professional`) or some other word (e.g. "terminal emulator" — leave alone)

- [ ] **Step 2: `/login` page**

In `src/app/login/page.tsx`:
- Wrap form in a centered card: `<div className="mx-auto max-w-[400px] mt-16 p-8 ghc-card">`
- Verify form uses `ghc-input` and `ghc-btn-primary`
- Verify error states use `ghc-alert-danger` (or existing inline classes)
- Add `prefers-reduced-motion` honored (already global)

In `src/app/login/_login-form.tsx`:
- Verify submit button is disabled while pending (existing `SubmitButton` handles this)

- [ ] **Step 3: `/status` page**

In `src/app/status/page.tsx`:
- Top banner: `ghc-status-banner` (already exists)
- Service list: `ghc-table` (already exists)
- **Add uptime bars**: import new `uptime-bars.tsx` component, render below service list
- Use new indigo accent for any colored states

- [ ] **Step 4: Create `uptime-bars.tsx`**

Create `src/app/_components/uptime-bars.tsx`:

```tsx
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';

interface DayStatus {
  date: string; // ISO yyyy-mm-dd
  ok: boolean;
}

interface Props {
  days: DayStatus[];
}

/**
 * 90-day uptime bar chart. Each cell = 1 day; green = ok, red = degraded.
 * Renders as a horizontal strip of cells; cell tooltip on hover via title attr.
 */
export async function UptimeBars({ days }: Props): Promise<ReactElement> {
  const t = await getTranslations('status');
  return (
    <div className="ghc-uptime-bars" data-testid="ghc-uptime-bars">
      <div className="ghc-uptime-bars-label">{t('uptime90d')}</div>
      <div className="ghc-uptime-bars-grid">
        {days.map((d) => (
          <span
            key={d.date}
            className="ghc-uptime-bar"
            data-state={d.ok ? 'ok' : 'fail'}
            title={`${d.date}: ${d.ok ? t('uptimeOk') : t('uptimeFail')}`}
            aria-label={`${d.date}: ${d.ok ? t('uptimeOk') : t('uptimeFail')}`}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `/get-started` page**

In `src/app/get-started/page.tsx`:
- Use 4-step grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`
- Each step: numbered badge (circle with `bg-[var(--color-accent)] text-[var(--color-accent-ink)]`) + title + curl example in `ghc-code-block`

- [ ] **Step 6: `/repo/[owner]/[name]` page**

In `src/app/repo/[owner]/[name]/page.tsx`:
- Hero: owner/name in mono font, large (`font-mono text-3xl font-bold`)
- Stars/forks as large numbers (`text-4xl font-semibold tabular-nums`)
- Tabs (overview/branches/releases) preserve existing logic
- `ghc-api-shape` already exists — keep

- [ ] **Step 7: `/account` + `/account/layout.tsx`**

In `src/app/account/layout.tsx`:
- Verify sidebar uses `ghc-account-sidebar-link`
- Update any `terminal` references to `professional`

In `src/app/account/page.tsx`:
- Verify it uses `ghc-card`, `ghc-stat`, indigo accent

- [ ] **Step 8: `/account/keys` page**

In `src/app/account/keys/page.tsx`:
- Verify table uses `ghc-table`
- Verify status filter uses `ghc-chip`
- Verify create button uses `ghc-btn-primary`

- [ ] **Step 9: `/account/keys/[id]` page**

In `src/app/account/keys/[id]/page.tsx`:
- 2-column layout: left `ghc-detail-dl`, right `ghc-history-list` (or equivalent)
- Verify no `terminal` literals

- [ ] **Step 10: `/account/keys/request` page**

In `src/app/account/keys/request/page.tsx`:
- Centered form, `max-w-md mx-auto`
- Hint text below each input

- [ ] **Step 11: `/account/password` page**

In `src/app/account/password/page.tsx`:
- Simple form
- Verify error states use `ghc-alert-danger`

- [ ] **Step 12: `/docs` page**

In `src/app/docs/page.tsx`:
- 6-card grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- Each card: `ghc-card` with title + short description

- [ ] **Step 13: `/docs/api/[slug]` page**

In `src/app/docs/api/[slug]/page.tsx` (template):
- Sidebar + main: keep existing layout
- Code examples: wrap in `ghc-code-block`
- Verify indigo accent for syntax highlighting tokens

- [ ] **Step 14: `/init/*` pages**

In `src/app/init/page.tsx` and `src/app/init/*/page.tsx`:
- Top progress bar: 4 steps
- Each step form: `ghc-card`, `ghc-btn-primary` / `ghc-btn-secondary`
- Verify no `terminal` literals

- [ ] **Step 15: Run quality gates**

```bash
npm run typecheck
npm run lint
npm test
```

Expected:
- typecheck: errors ≤ 26
- lint: no new errors
- test: all previous tests still pass, no new failures

- [ ] **Step 16: Visual smoke test per surface**

For each public page:
1. Open page at desktop (≥1024px) — verify `professional` theme (light bg, indigo accent)
2. Resize to tablet (640-1024px) — verify layout still readable
3. Resize to mobile (<640px) — verify hamburger nav + responsive collapse
4. Tab through interactive elements — no missing focus rings
5. Toggle `prefers-reduced-motion` in DevTools → no fade-up

- [ ] **Step 17: Verify no `terminal` theme references remain in public pages**

Run:
```bash
grep -r "data-theme=\"terminal\"\|ghc_theme.*terminal\|theme === 'terminal'" src/app/login src/app/status src/app/get-started src/app/repo src/app/account src/app/docs src/app/init
```
Expected: no matches.

- [ ] **Step 18: Commit**

```bash
git add src/app/login/ src/app/status/ src/app/get-started/ src/app/repo/ src/app/account/ src/app/docs/ src/app/init/ src/app/_components/uptime-bars.tsx src/app/globals.css
git commit -m "feat(public-pages): apply professional design language across 12 public pages

- /login: centered card layout
- /status: add 90-day uptime bars (ghc-uptime-bars)
- /get-started: 4-step grid with numbered badges
- /repo/[owner]/[name]: hero with mono owner/name + tabular stats
- /account/*: apply indigo accent + ghc-* components
- /account/keys/*: 2-col layout for detail, status filter pills
- /docs: 6-card grid (3-col desktop)
- /docs/api/*: ghc-code-block for code examples
- /init/*: 4-step progress bar + ghc-card forms
- Audit all 12 pages: zero remaining 'terminal' theme literals"
```

---

## Self-Review Checklist

After writing this plan (do NOT skip):

1. **Spec coverage** — every spec section maps to at least one task step:
   - §1 背景与目标 → enforced by Global Constraints
   - §2.1 palette + accent → Task 1 Steps 5-7
   - §2.2 typography → Task 1 Step 5 (font tokens)
   - §2.3 spacing/radius/shadow → Task 1 Step 5 (spacing tokens), classes throughout
   - §2.4 micro-animations → already global; no change needed
   - §3.1 site header → Task 3 Steps 1, 3
   - §3.2 site footer → Task 3 Steps 4, 5
   - §3.3 homepage 5 sections → Task 2 Steps 1, 2, 10
   - §3.4 other 12 pages → Task 4
   - §3.5 design language cheat sheet → Task 1 (tokens) + Task 2 (CSS classes)
   - §4.1 性能 (LCP < 1.5s) → Server Components enforced; manual lighthouse check Task 2 Step 15
   - §4.2 a11y (focus rings, ARIA, contrast) → all Task 1-4 manual smoke tests include Tab nav
   - §4.3 响应式 → Task 2 Step 16, Task 3 Step 9, Task 4 Step 16
   - §5.1 4 commits → exactly 4 tasks (this plan)
   - §5.2 acceptance gates → Steps 14/9/15/15 per task
   - §5.3 out of scope → respected (no API/prisma/dependency changes)

2. **Placeholder scan** — searched for TBD / TODO / "implement later" / "fill in details" — none.

3. **Type consistency** — `resolveTheme` signature unchanged across Tasks; `ThemeId` gains `'professional-dark'`; `LEGACY_THEME_ALIASES` is a new export; all uses match.

4. **No silent breakage**:
   - `terminal` cookie → `professional` (via `LEGACY_THEME_ALIASES`) ✓
   - Admin pages already use `data-theme` set by admin layout (deferred to next spec); they keep rendering with their own choice ✓
   - Existing `ghc-*` classes are preserved (only token VALUES change) ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-10-public-pages-redesign.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**