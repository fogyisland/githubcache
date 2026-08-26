/**
 * Visual theme registry.
 *
 * Three opinionated themes for the public surface. Each one is a deliberate
 * choice — not an AI-default skin — picked from the design brainstorm at the
 * end of M9. Token definitions live here so server (cookie / DB), client
 * (switcher UI) and CSS (`globals.css`) all share a single source of truth.
 *
 * The CSS file mirrors these tokens into three `[data-theme="<id>"]` blocks;
 * component classes (`ghc-card`, `ghc-btn-primary`, ...) only reference the
 * variable names below, never raw hex values.
 */

export const THEME_IDS = ['terminal', 'editorial', 'brutalist'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = 'terminal';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  shortLabel: string;
  blurb: string;
  /**
   * Mood summary surfaced in the switcher tooltip + admin settings copy.
   * One short sentence — describes the *why*, not the *what*.
   */
  mood: string;
  /** next/font/css var that drives display + body + mono for this theme. */
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  terminal: {
    id: 'terminal',
    label: 'Terminal',
    shortLabel: 'T',
    blurb: 'Dark IDE / command line',
    mood: 'Late-night dev — every page is a shell session.',
    fonts: {
      display: 'var(--font-mono)',
      body: 'var(--font-mono)',
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
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function resolveTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}