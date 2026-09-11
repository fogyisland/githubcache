/**
 * Lightweight status snapshot for the site-footer live dot. Cached 60s
 * to avoid hammering /api/v1/status from every page render.
 */
import { unstable_cache } from 'next/cache';

export interface StatusPing {
  ok: boolean;
}

export const fetchStatusPing = unstable_cache(
  async (): Promise<StatusPing> => {
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:5002'}/api/v1/status`,
        { cache: 'no-store' },
      );
      return { ok: r.ok };
    } catch {
      return { ok: false };
    }
  },
  ['site-footer-status-ping'],
  { revalidate: 60 },
);
