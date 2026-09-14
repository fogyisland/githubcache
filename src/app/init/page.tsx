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
 * Fresh-empty DB guard (M32.6.1): on a brand-new deploy the URL is set
 * but the `users` table doesn't exist yet. `getSetupStatus()` queries
 * `prisma.user.count(...)` and Prisma raises P2021 ("table does not
 * exist"). Without the catch the wizard itself 500s and the operator
 * can't even reach step 1 to create the tables. We swallow the
 * specific P2021 error and fall through to /init/db — the wizard's
 * step-1 form lets the operator fill DATABASE_URL (if missing) and
 * then run CREATE TABLE statements.
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
  //
  // On a fresh-empty DB (URL set, tables not yet created) getSetupStatus
  // throws P2021. We treat that the same as `done=false` and fall through
  // to the wizard; otherwise the operator can't reach the wizard to
  // create the tables in the first place.
  let statusDone = false;
  try {
    const status = await getSetupStatus();
    statusDone = status.done;
  } catch (e) {
    // P2021 = "table does not exist" — expected on fresh DB. Anything
    // else is genuinely unexpected, log it so the operator can diagnose
    // (e.g. DATABASE_URL pointing at a non-MySQL host).
    const code = (e as { code?: string }).code;
    if (code !== 'P2021') {
      // eslint-disable-next-line no-console
      console.error('[init] getSetupStatus threw, treating as not-done:', e);
    }
    statusDone = false;
  }
  if (statusDone) {
    redirect('/api/setup/backfill');
  }
  redirect('/init/db');
}