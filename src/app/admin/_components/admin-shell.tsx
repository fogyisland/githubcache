import type { ReactElement, ReactNode } from 'react';
import type { AdminVariantId } from '@/lib/admin/variant';
import type { AdminModeId } from '@/lib/admin/mode';
import { AdminSidebar, type AdminSectionSlug } from './admin-sidebar';
import { AdminStatusBar, type AdminStatusBarData } from './admin-status-bar';

interface Props {
  /** Active section slug (drives the sidebar indicator). */
  current: AdminSectionSlug;
  /** Active admin variant — drives the chrome treatment (typography, radius). */
  variant: AdminVariantId;
  /** Active admin color mode (light | dark) — drives all color tokens. */
  mode: AdminModeId;
  /** Caller's role + email (sidebar uses role; status bar uses email). */
  user: { email: string; role: 'admin' | 'operator' };
  /** SSR-prefetched status payload (avoids flash before first poll). */
  initialStatus: AdminStatusBarData;
  /** Page content. */
  children: ReactNode;
}

/**
 * Top-level admin shell. Renders the sidebar (fixed left on desktop) + the
 * main content column. The status bar is mounted only for mission_control —
 * the other variants have their own persistent UI affordances (Inspector:
 * right audit rail; Workbench: top workflow ribbon) that land in later
 * milestones.
 *
 * M26.x — `data-admin` drives typography / radius (per-variant), and the
 * new `data-admin-mode` drives all color tokens (light | dark). Variants
 * no longer touch color directly — the two systems are orthogonal so
 * "Daylight + Mission Control" or "Nightfall + Workbench" all render with
 * consistent palettes.
 *
 * Styling is delegated to `[data-admin="…"]` + `[data-admin-mode="…"]`
 * blocks in globals.css — the shell just sets the attributes on the
 * wrapper.
 */
export async function AdminShell({
  current,
  variant,
  mode,
  user,
  initialStatus,
  children,
}: Props): Promise<ReactElement> {
  const sidebar = await AdminSidebar({ current, userRole: user.role });
  return (
    <div className="ghc-admin-shell" data-admin={variant} data-admin-mode={mode}>
      {sidebar}
      <div className="ghc-admin-main">
        <main className="ghc-admin-main-inner">{children}</main>
        {variant === 'mission_control' ? <AdminStatusBar initialData={initialStatus} /> : null}
      </div>
    </div>
  );
}
