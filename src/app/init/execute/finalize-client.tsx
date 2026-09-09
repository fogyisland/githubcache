'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  runMigrateSubtask,
  createAdminSubtask,
  lockSetupSubtask,
} from '../_actions/finalize-setup';

type Status = 'pending' | 'running' | 'ok' | 'error';

interface ChecklistState {
  migrate: Status;
  admin: Status;
  lock: Status;
}

const INITIAL: ChecklistState = { migrate: 'pending', admin: 'pending', lock: 'pending' };

const LABELS = {
  migrate: '创建数据表（init-db 一次性建表）',
  admin: '创建管理员账号',
  lock: '锁定 /init 页面，跳转到登录',
} as const;

/**
 * /init/execute live checklist (M28.bug17).
 *
 * Three subtasks run sequentially. Each updates its row in the UI as
 * it transitions pending → running → ok. On error, the checklist stops
 * and shows the error inline with a retry button.
 *
 * Why split instead of one big action: the user wants to SEE what's
 * happening. With three subtasks + transitions, the page reflects the
 * actual state of the migration / user creation / lock in real time.
 */
export function FinalizeClient({ initialError }: { initialError?: string | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<ChecklistState>(() =>
    initialError ? { migrate: 'error', admin: 'pending', lock: 'pending' } : INITIAL,
  );
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [started, setStarted] = useState(!initialError);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;

    async function run() {
      // --- migrate ---
      setState((s) => ({ ...s, migrate: 'running' }));
      const m = await runMigrateSubtask();
      if (cancelled) return;
      if (!m.ok) {
        setState((s) => ({ ...s, migrate: 'error' }));
        setError(m.error ?? '迁移失败');
        return;
      }
      setState((s) => ({ ...s, migrate: 'ok' }));

      // --- admin ---
      setState((s) => ({ ...s, admin: 'running' }));
      const a = await createAdminSubtask();
      if (cancelled) return;
      if (!a.ok) {
        setState((s) => ({ ...s, admin: 'error' }));
        setError(a.error ?? '创建管理员失败');
        return;
      }
      setState((s) => ({ ...s, admin: 'ok' }));

      // --- lock ---
      setState((s) => ({ ...s, lock: 'running' }));
      const l = await lockSetupSubtask();
      if (cancelled) return;
      if (!l.ok) {
        setState((s) => ({ ...s, lock: 'error' }));
        setError(l.error ?? '锁定失败');
        return;
      }
      setState((s) => ({ ...s, lock: 'ok' }));

      // small delay so user sees the final ✓ before navigation
      setTimeout(() => router.replace('/login'), 400);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, started]);

  function retry() {
    setError(null);
    setState({ migrate: 'pending', admin: 'pending', lock: 'pending' });
    setStarted(true);
  }

  return (
    <div className="ghc-init-checklist">
      {(Object.keys(LABELS) as Array<keyof ChecklistState>).map((k) => (
        <ChecklistRow key={k} label={LABELS[k]} status={state[k]} />
      ))}
      {error && (
        <div className="ghc-init-error-wrap">
          <div className="ghc-init-error">{error}</div>
          <button type="button" className="ghc-btn-primary" onClick={retry}>
            重试
          </button>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ label, status }: { label: string; status: Status }) {
  return (
    <div className="ghc-init-checklist-row" data-status={status}>
      <span className="ghc-init-checklist-icon" aria-hidden>
        {status === 'pending' && '○'}
        {status === 'running' && <span className="ghc-init-spinner" />}
        {status === 'ok' && '✓'}
        {status === 'error' && '✕'}
      </span>
      <span className="ghc-init-checklist-label">{label}</span>
      <span className="ghc-init-checklist-status">
        {status === 'pending' && '等待'}
        {status === 'running' && '执行中…'}
        {status === 'ok' && '完成'}
        {status === 'error' && '失败'}
      </span>
    </div>
  );
}