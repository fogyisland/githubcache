import type { ReactElement } from 'react';

/**
 * M19 — Run via provider (stub).
 *
 * M19.7 only adds the card slot on /admin/ingestion; the full provider
 * dropdown + preview + run client island lands in M19.10. This stub keeps
 * the page typechecking while signalling to the user that the card is
 * reserved.
 */
export function RunViaProvider(): ReactElement {
  return (
    <section className="ghc-admin-card" aria-label="Run via provider">
      <p className="ghc-admin-card-empty">
        Run-via-provider card will be implemented in M19.10.
      </p>
    </section>
  );
}