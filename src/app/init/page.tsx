import { redirect } from 'next/navigation';
import { getSetupStatus } from '@/lib/init/setup-status';

/**
 * /init orchestrator (M28.bug12).
 *
 * Three paths land here:
 *   1. Fresh deploy — middleware sees ghc_setup_done cookie absent and
 *      redirects every other request here. We forward to step 1.
 *   2. Stale bookmark — middleware already bounced ghc_setup_done cookies
 *      back to /, so this page only runs for incomplete setups.
 *   3. M32.6 backfill — environment was initialized in a previous deploy
 *      (or before this fix landed), so the DB has an admin user but the
 *      browser has no cookie. We can't set cookies from a server component
 *      (Next.js forbids it), so we redirect to /api/setup/backfill, which
 *      is a route handler allowed to mutate cookies. That handler then
 *      308's to / once the cookie is set.
 *
 * Server-component "use server" pages need dynamic rendering because the
 * setup state can change between requests (a wizard step just finished).
 */
export const dynamic = 'force-dynamic';

export default async function InitPage(): Promise<never> {
  // M32.6 backfill: if the DB is already provisioned but this browser
  // doesn't carry the cookie, route through the backfill handler (which
  // is allowed to set cookies; this page is not). Without this, any user
  // landing on the site after a fresh deploy — where the wizard ran in
  // a different browser session — would loop through /init forever.
  const status = await getSetupStatus();
  if (status.done) {
    redirect('/api/setup/backfill');
  }
  redirect('/init/db');
}