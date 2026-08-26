/**
 * Admin surface variant registry.
 *
 * Three opinionated design directions for the admin app, parallel to the
 * public surface's theme system (M10) but independent — operator can be in
 * `workbench` admin while the public site is in `editorial` theme.
 *
 * Each variant takes one real aesthetic risk and owns it (see spec §4.2):
 *   - mission_control: looks like a 2003 sysadmin CRT (radar HUD)
 *   - inspector: feels like an IRS form (forensic paper trail)
 *   - workbench: feels like an IKEA manual (assembly clarity)
 *
 * The CSS file mirrors these into three `[data-admin="<id>"]` blocks;
 * component classes (`ghc-admin-*`) only reference variable names, never
 * raw hex values.
 */

export const ADMIN_VARIANT_IDS = ['mission_control', 'inspector', 'workbench'] as const;
export type AdminVariantId = (typeof ADMIN_VARIANT_IDS)[number];

export const DEFAULT_ADMIN_VARIANT: AdminVariantId = 'mission_control';

export interface AdminVariantMeta {
  id: AdminVariantId;
  label: string;
  shortLabel: string;
  blurb: string;
  /** One-sentence mood summary surfaced in the switcher tooltip. */
  mood: string;
}

export const ADMIN_VARIANTS: Record<AdminVariantId, AdminVariantMeta> = {
  mission_control: {
    id: 'mission_control',
    label: 'Mission Control',
    shortLabel: 'M',
    blurb: '24/7 ops bridge / radar HUD',
    mood: '2003 sysadmin CRT — every pixel serves a decision.',
  },
  inspector: {
    id: 'inspector',
    label: 'Inspector',
    shortLabel: 'I',
    blurb: 'Forensic audit / paper trail',
    mood: 'IRS form calm — slow deliberation as a feature.',
  },
  workbench: {
    id: 'workbench',
    label: 'Workbench',
    shortLabel: 'W',
    blurb: 'Assembly manual / IKEA',
    mood: 'IKEA clarity — numbered steps, oversized numbers.',
  },
};

export function isAdminVariant(value: unknown): value is AdminVariantId {
  return (
    typeof value === 'string' && (ADMIN_VARIANT_IDS as readonly string[]).includes(value)
  );
}

export function resolveAdminVariant(value: unknown): AdminVariantId {
  return isAdminVariant(value) ? value : DEFAULT_ADMIN_VARIANT;
}