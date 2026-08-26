import type { ReactElement, ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Empty-state block — centered, with a glyph + headline + optional subtext +
 * optional CTA. Used by list pages when the table has zero rows.
 */
export function AdminEmptyState({ icon, title, description, action }: Props): ReactElement {
  return (
    <div className="ghc-admin-empty">
      <div className="ghc-admin-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3 className="ghc-admin-empty-title">{title}</h3>
      {description ? <p className="ghc-admin-empty-desc">{description}</p> : null}
      {action ? <div className="ghc-admin-empty-action">{action}</div> : null}
    </div>
  );
}