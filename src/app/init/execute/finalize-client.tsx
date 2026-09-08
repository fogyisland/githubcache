'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { finalizeSetup } from '../_actions/finalize-setup';

/**
 * Client island (M28.bug12): fires finalizeSetup on mount.
 *
 * Server-component pages can't call server actions in the render phase
 * (Next.js 14 enforces this), so we need a 'use client' sibling to fire
 * the action when /init/execute mounts. The action runs `prisma migrate
 * deploy`, sets ghc_setup_done=1 cookie, and returns ok.
 */
export function FinalizeClient({ initialError }: { initialError?: string | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(
    initialError ? 'error' : 'pending',
  );
  const [error, setError] = useState<string | null>(initialError ?? null);

  useEffect(() => {
    if (state !== 'pending') return;
    let cancelled = false;
    (async () => {
      const result = await finalizeSetup();
      if (cancelled) return;
      if (result.ok) {
        setState('ok');
        router.replace('/login');
      } else {
        setState('error');
        setError(result.error ?? '迁移失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, state]);

  if (state === 'pending') {
    return (
      <div className="ghc-init-progress">
        <div className="ghc-init-spinner" aria-hidden />
        <p>正在运行 Prisma 迁移并锁定 /init 页面…</p>
      </div>
    );
  }

  if (state === 'ok') {
    return (
      <div className="ghc-init-progress">
        <p>初始化完成，正在跳转到登录页…</p>
      </div>
    );
  }

  return (
    <div className="ghc-init-error-wrap">
      <div className="ghc-init-error">{error}</div>
      <button
        type="button"
        className="ghc-btn-primary"
        onClick={() => {
          setState('pending');
          setError(null);
        }}
      >
        重试
      </button>
    </div>
  );
}