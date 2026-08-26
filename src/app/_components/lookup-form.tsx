'use client';

import { useFormState } from 'react-dom';
import { lookupAction, type LookupFormState } from '@/app/_actions/lookup';
import { LookupResultCard } from './lookup-result-card';
import { SubmitButton } from './submit-button';

const initialState: LookupFormState = { status: 'idle' };

export function LookupForm() {
  const [state, formAction] = useFormState(lookupAction, initialState);

  return (
    <div className="ghc-card ghc-fade-up p-6 shadow-lg sm:p-8">
      <form
        action={formAction}
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        aria-label="Look up a GitHub repository"
      >
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Owner</span>
          <input
            type="text"
            name="owner"
            placeholder="e.g. facebook"
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-input"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">Repository</span>
          <input
            type="text"
            name="name"
            placeholder="e.g. react"
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-input"
          />
        </label>
        <div className="flex">
          <SubmitButton />
        </div>
      </form>

      {state.status === 'invalid' && (
        <div
          role="alert"
          className="ghc-fade-up mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{state.message}</span>
        </div>
      )}
      {state.status === 'rate_limited' && (
        <div
          role="alert"
          className="ghc-fade-up mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a1 1 0 011 1v3a1 1 0 11-2 0V7a1 1 0 011-1zm0 8a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span>{state.message}</span>
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="ghc-fade-up mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>{state.message}</span>
        </div>
      )}
      {state.status === 'ok' && state.result && <LookupResultCard result={state.result} />}
    </div>
  );
}
