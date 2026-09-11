'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';

interface Props {
  tokenId: string;
}

/**
 * Client atom — per-row "Test" button for the GitHub tokens table.
 *
 * Calls `POST /api/admin/github-tokens/[id]/test`, which hits GitHub's
 * `/user` endpoint with the row's plaintext PAT (DB-direct per M21). The
 * result chip cycles idle → pending → ok | fail and stays visible after
 * the click so an operator can scan a row and see its last-known health
 * at a glance.
 *
 * On failure we surface the upstream HTTP status returned by the route so
 * the operator can distinguish "PAT revoked" (401) from "rate-limited"
 * (403/429) without opening server logs.
 *
 * Throttle: after a successful or failed round-trip, the button stays
 * disabled for 2 seconds. This prevents an operator mashing Test across
 * 10 rows from exhausting GitHub's 60/hr unauthenticated bucket (which
 * the upstream call shares even though our token is authenticated).
 */
const POST_RUN_COOLDOWN_MS = 2_000;

export function AdminTokenTestButton({ tokenId }: Props): ReactElement {
  const t = useTranslations('admin.githubTokens.test');
  const [result, setResult] = useState<'idle' | 'pending' | 'ok' | 'fail'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  // Disabled state covers both in-flight ('pending') and the post-run
  // cooldown. Stored as an absolute timestamp so a re-render mid-cooldown
  // can't reset it.
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const disabled = result === 'pending' || Date.now() < cooldownUntil;

  async function run(): Promise<void> {
    if (disabled) return;
    setResult('pending');
    setDetail(null);
    try {
      const res = await adminFetch<{ ok: boolean; upstreamStatus?: number }>(
        `/api/admin/github-tokens/${tokenId}/test`,
        { method: 'POST' },
      );
      if (res.ok) {
        setResult('ok');
      } else {
        setResult('fail');
        setDetail(res.upstreamStatus ? String(res.upstreamStatus) : null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult('fail');
      setDetail(msg);
    } finally {
      setCooldownUntil(Date.now() + POST_RUN_COOLDOWN_MS);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled}
      className={`ghc-btn-ghost ghc-btn-test-${result}`}
      aria-live="polite"
      title={detail ?? undefined}
    >
      {t(result)}
    </button>
  );
}
