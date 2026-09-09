/**
 * M26.x — admin color mode registry.
 *
 * Two-mode system that controls the admin surface's color tokens,
 * independent of the three admin variants (mission_control /
 * inspector / workbench). The variants now own ONLY typography +
 * radius + border-weight; the mode owns color. This fixes the
 * "one element blue, one element white" drift between pages.
 *
 *   light ("Daylight")  — paper surface, ink text, cobalt accent
 *   dark  ("Nightfall")  — warm charcoal, bone text, luminous cobalt
 *
 * Both palettes are deliberately not the AI-default cream + terracotta
 * or pure-black + acid-green. Cobalt is the brand accent of the
 * githubcache service (it shows up in the logo + the public surface)
 * and reads as "control center, not marketing page".
 */

export const ADMIN_MODE_IDS = ['light', 'dark'] as const;
export type AdminModeId = (typeof ADMIN_MODE_IDS)[number];

export const DEFAULT_ADMIN_MODE: AdminModeId = 'light';

export interface AdminModeMeta {
  id: AdminModeId;
  label: string;
  shortLabel: string;
  /** One-sentence mood summary surfaced in the switcher tooltip. */
  mood: string;
}

export const ADMIN_MODES: Record<AdminModeId, AdminModeMeta> = {
  light: {
    id: 'light',
    label: 'Daylight',
    shortLabel: 'L',
    mood: 'Paper surface, ink text, cobalt accent — clean for the long audit trail.',
  },
  dark: {
    id: 'dark',
    label: 'Nightfall',
    shortLabel: 'D',
    mood: 'Warm charcoal, bone text, luminous cobalt — late-ops focus mode.',
  },
};

export function isAdminMode(value: unknown): value is AdminModeId {
  return (
    typeof value === 'string' && (ADMIN_MODE_IDS as readonly string[]).includes(value)
  );
}

export function resolveAdminMode(value: unknown): AdminModeId {
  return isAdminMode(value) ? value : DEFAULT_ADMIN_MODE;
}
