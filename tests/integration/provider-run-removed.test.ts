import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * M31 — provider-run bulk enqueue endpoint removed.
 *
 * Pre-M31: `POST /api/admin/providers/[id]/run` enqueued a batch of
 * refresh_jobs from a provider's parsed JSON. M31 removed it; the
 * admin UI now uses the `preview` endpoint for read-only inspection
 * and per-row enqueue is done via the existing refresh-one queue.
 *
 * Test strategy:
 *
 *   1. The route module must not exist on disk — deleting the route
 *      is the M31 cleanup. This is the strongest invariant because
 *      Next.js will 404 any request to a non-existent route file.
 *   2. The companion `preview/route.ts` and `toggle/route.ts` still
 *      exist — verifying that only `run/` was removed.
 *
 * We use `existsSync` (Node's fs) rather than an HTTP fetch because
 * the integration suite imports route handlers directly — there is no
 * live Next.js server in the vitest runtime. The on-disk check is the
 * canonical M31 signal.
 */

const providersRouteRoot = resolve(
  process.cwd(),
  'src/app/api/admin/providers/[id]',
);

describe('POST /api/admin/providers/[id]/run (M31 — removed)', () => {
  it('route file does not exist (M31 cleanup removed bulk provider-run)', () => {
    const runRoute = resolve(providersRouteRoot, 'run/route.ts');
    expect(existsSync(runRoute)).toBe(false);
  });

  it('preview/route.ts still exists (companion endpoint not removed)', () => {
    const previewRoute = resolve(providersRouteRoot, 'preview/route.ts');
    expect(existsSync(previewRoute)).toBe(true);
  });

  it('toggle/route.ts still exists (companion endpoint not removed)', () => {
    const toggleRoute = resolve(providersRouteRoot, 'toggle/route.ts');
    expect(existsSync(toggleRoute)).toBe(true);
  });

  it('the providers/[id] directory contains exactly preview/ + toggle/ (no run/)', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(providersRouteRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(entries).toEqual(['preview', 'toggle']);
  });
});
