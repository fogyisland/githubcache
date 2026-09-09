'use client';

import { useTransition, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { lookupAction, type LookupFormState } from '@/app/_actions/lookup';

interface QuickRepo {
  owner: string;
  name: string;
  blurb: string;
}

const QUICK_REPOS: QuickRepo[] = [
  { owner: 'torvalds', name: 'linux', blurb: 'the kernel' },
  { owner: 'microsoft', name: 'vscode', blurb: 'editor' },
  { owner: 'vitejs', name: 'vite', blurb: 'build tool' },
];

export function QuickTry(): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function tryOne(repo: QuickRepo): void {
    const fd = new FormData();
    fd.set('owner', repo.owner);
    fd.set('name', repo.name);
    startTransition(async () => {
      const state: LookupFormState = await lookupAction(
        { status: 'idle' },
        fd,
      );
      if (state.status === 'ok' && state.result?.canonical) {
        const [owner, name] = state.result.canonical.split('/');
        if (owner && name) router.push(`/repo/${owner}/${name}`);
      }
    });
  }

  return (
    <section className="ghc-quick-try" data-testid="ghc-quick-try">
      <div className="ghc-section-eyebrow">Or just pick one</div>
      <h2 className="ghc-section-heading">Three repos to try right now.</h2>
      <div className="ghc-quick-try-buttons">
        {QUICK_REPOS.map((r) => (
          <button
            key={`${r.owner}/${r.name}`}
            type="button"
            className="ghc-quick-try-btn"
            disabled={pending}
            onClick={() => tryOne(r)}
          >
            <span className="ghc-quick-try-owner">{r.owner}/</span>
            <span className="ghc-quick-try-name">{r.name}</span>
            <span className="ghc-quick-try-blurb">— {r.blurb}</span>
          </button>
        ))}
      </div>
      {pending ? (
        <p className="ghc-quick-try-pending">Looking up…</p>
      ) : null}
    </section>
  );
}