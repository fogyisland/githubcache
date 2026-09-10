# Admin Data-Fetch Policy

Three patterns coexist intentionally. New pages must pick one based on
the operation type, not personal preference.

## Pattern 1: Server Component + `src/lib/db/*` helper

**When:** reading data for the initial render of an admin page.

**Why:** no client round-trip, no JSON serialization, can stream JSX,
supports Suspense.

**Example:** `/admin/users` — `import { listUsers } from '@/lib/db/users'`,
called inline in the page server component.

**Don't:** import `prisma` from `@/lib/db/client` directly in a page.
Always go through a helper in `src/lib/db/*`.

## Pattern 2: Server Action + `useActionState`

**When:** forms that mutate settings and want inline feedback without
leaving the page (no full reload).

**Why:** progressive enhancement, no JS round-trip on submit, simple
state-machine via `useActionState`.

**Example:** `/admin/api-settings`, `/admin/email`.

**Don't:** use this for row-level operations (approve key, disable user)
— those should be optimistic UI from a client component using adminFetch.

## Pattern 3: Client component + `adminFetch`

**When:** row-level mutations from a table (approve / revoke / disable /
toggle / delete) where the user expects instant feedback and possibly
optimistic updates.

**Why:** stays on the page, can update local state, can show inline
toast / inline `<p role="status">`.

**Example:** `src/app/admin/api-keys/_components/key-row-actions.tsx` —
calls `adminFetch('/api/admin/api-keys/${id}/approve', { method: 'POST' })`.

**Don't:** use raw `fetch('/api/admin/...')` — always go through
`adminFetch` so CSRF + credentials are wired correctly.

## What we explicitly DON'T do

- No global toast system (yet).
- No `redirect()` + searchParams flash pattern.
- No client-side SWR / React Query / etc.
- No `@/lib/api/` client helper other than adminFetch.
- No raw `fetch('/api/admin/...')` in client components.