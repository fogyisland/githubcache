import { redirect } from 'next/navigation';

/**
 * /init orchestrator (M28.bug12).
 *
 * Two paths land here:
 *   1. Fresh deploy — middleware sees ghc_setup_done cookie absent and
 *      redirects every other request here. We forward to step 1.
 *   2. Stale bookmark — middleware already bounced ghc_setup_done cookies
 *      back to /, so this page only runs for incomplete setups.
 *
 * Server-component "use server" pages need dynamic rendering because the
 * setup state can change between requests (a wizard step just finished).
 */
export const dynamic = 'force-dynamic';

export default function InitPage(): never {
  redirect('/init/db');
}