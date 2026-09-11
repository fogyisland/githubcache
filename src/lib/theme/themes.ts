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