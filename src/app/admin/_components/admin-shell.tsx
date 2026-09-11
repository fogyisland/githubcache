import type { ReactElement, ReactNode } from 'react';
import type { AdminVariantId } from '@/lib/admin/variant';
import type { AdminModeId } from '@/lib/admin/mode';
import { AdminSidebar } from './admin-sidebar';
import { AdminStatusBar, type AdminStatusBarData } from './admin-status-bar';

interface Props {
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
 * M30 — sidebar is now a client component that derives its own active
 * section from `usePathname()`; the shell no longer passes `current`
 * down. Previously the server-side `current` slug was frozen on first
 * render and didn't update on soft-nav. (The `x-pathname` middleware
 * header is still set — the shell just stops reading it.)
 *
 * Styling is delegated to `[data-admin="…"]` + `[data-admin-mode="…"]`
 * blocks in globals.css — the shell just sets the attributes on the
 * wrapper.
 */
export async function AdminShell({
  variant,
  mode,
  user,
  initialStatus,
  children,
}: Props): Promise<ReactElement> {
  // AdminSidebar is a client component (uses usePathname + useTranslations).
  // Render it directly as JSX — calling it as a function here would
  // invoke client code in this server context, which is the React 19
  // "Attempted to call client function from server" error.
  return (
    <div className="ghc-admin-shell" data-admin={variant} data-admin-mode={mode}>
      <AdminSidebar userRole={user.role} />
      <div className="ghc-admin-main">
        <main className="ghc-admin-main-inner">{children}</main>
        {variant === 'mission_control' ? <AdminStatusBar initialData={initialStatus} /> : null}
      </div>
    </div>
  );
}
