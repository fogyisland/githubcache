import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { validateSession } from '@/lib/auth/session';
import type { User } from '@prisma/client';

/**
 * M28 — shared admin-only auth gate.
 *
 * Replaces the 12-line cookie/validateSession/redirect boilerplate
 * that was copy-pasted into every admin page. Three of the pages
 * (api-settings, email, database/operations) also needed the
 * `x-pathname` header for tab highlighting, so we return that too
 * for callers that care.
 *
 * Usage in a server component:
 * ```ts
 * export default async function AdminXPage() {
 *   await requireAdmin();
 *   // ... rest of page
 * }
 *
 *   // or, with pathname for tab nav:
 *   const { pathname } = await requireAdmin();
 * ```
 *
 * Behavior:
 *  - No session → redirect('/login')
 *  - Session but role !== 'admin' → redirect('/admin')
 *  - Returns the User + the request pathname (for tabs / active-link)
 */
export async function requireAdmin(): Promise<{ user: User; pathname: string }> {
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(
    cookieStore.getAll().map((c) => [c.name, c.value]),
  );
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'admin') {
    redirect('/admin');
  }
  const headerStore = await headers();
  const pathname = headerStore.get('x-pathname') ?? '/admin';
  return { user, pathname };
}
