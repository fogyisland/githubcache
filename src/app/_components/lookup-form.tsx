'use client';

import { useFormState } from 'react-dom';
import { lookupAction, type LookupFormState } from '@/app/_actions/lookup';
import { LookupResultCard } from './lookup-result-card';
import { SubmitButton } from './submit-button';

const initialState: LookupFormState = { status: 'idle' };

export function LookupForm() {
  const [state, formAction] = useFormState(lookupAction, initialState);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Owner</span>
          <input
            type="text"
            name="owner"
            placeholder="e.g. facebook"
            required
            autoComplete="off"
            spellCheck={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Repository</span>
          <input
            type="text"
            name="name"
            placeholder="e.g. react"
            required
            autoComplete="off"
            spellCheck={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <SubmitButton />
      </form>

      {state.status === 'invalid' && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'rate_limited' && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ok' && state.result && <LookupResultCard result={state.result} />}
    </div>
  );
}
