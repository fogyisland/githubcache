import type { ReactElement, ReactNode } from 'react';

export type AdminChipVariant = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

interface Props {
  variant?: AdminChipVariant;
  children: ReactNode;
}

/**
 * Small inline chip for status labels in the admin surface.
 *
 * Theme-aware — reads from `--color-accent` / `--color-warn` / `--color-danger`
 * / `--color-ink-muted` so the chip color tracks the chosen public theme.
 */
export function AdminStatusChip({ variant = 'neutral', children }: Props): ReactElement {
  return <span className={`ghc-admin-chip ghc-admin-chip-${variant}`}>{children}</span>;
}