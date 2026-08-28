import type { ReactElement, ReactNode } from 'react';
import type { AdminVariantId } from '@/lib/admin/variant';
import { AdminSidebar, type AdminSectionSlug } from './admin-sidebar';
import { AdminStatusBar, type AdminStatusBarData } from './admin-status-bar';

interface Props {
  /** Active section slug (drives the sidebar indicator). */
  current: AdminSectionSlug;
  /** Active admin variant — drives the chrome treatment. */
  variant: AdminVariantId;
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
 * Styling is delegated to `[data-admin="…"]` blocks in globals.css — the
 * shell just sets the attribute on the wrapper.
 */
export async function AdminShell({
  current,
  variant,
  user,
  initialStatus,
  children,
}: Props): Promise<ReactElement> {
  const sidebar = await AdminSidebar({ current, userRole: user.role });
  return (
    <div className="ghc-admin-shell" data-admin={variant}>
      {sidebar}
      <div className="ghc-admin-main">
        <main className="ghc-admin-main-inner">{children}</main>
        {variant === 'mission_control' ? <AdminStatusBar initialData={initialStatus} /> : null}
      </div>
    </div>
  );
}
