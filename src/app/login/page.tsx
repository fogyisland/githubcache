'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

interface CsrfResponse {
  csrfToken: string;
}

interface LoginResponse {
  ok?: boolean;
  role?: string;
  error?: string;
}

/**
 * Admin login page.
 *
 * CSRF flow (double-submit cookie):
 *   1. On mount, GET /api/admin/auth/csrf — sets the `ghc_csrf` cookie AND
 *      returns the token in the body so JS can echo it in the header.
 *   2. On submit, POST /api/admin/auth/login with the token in both the
 *      `x-csrf-token` header (checked by middleware + route) and the body
 *      (belt-and-braces; the route's zod schema requires it).
 *   3. On 200, hard-navigate to /admin so the server component re-reads the
 *      freshly-set session cookie.
 */
export default function LoginPage(): ReactElement {
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [csrfLoading, setCsrfLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await fetch('/api/admin/auth/csrf', { credentials: 'same-origin' });
        const body = (await res.json()) as CsrfResponse;
        if (!cancelled) {
          setCsrfToken(body.csrfToken);
          setCsrfLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to initialize CSRF token. Please refresh.');
          setCsrfLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ email, password, csrf: csrfToken }),
      });
      const body = (await res.json()) as LoginResponse;
      if (res.ok && body.ok === true) {
        // Full page navigation — picks up the new session cookie server-side.
        window.location.href = '/admin';
        return;
      }
      setError(body.error ?? 'Login failed');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Admin login</h1>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ display: 'block', width: '100%', padding: '0.5rem' }}
          />
        </div>
        {error !== null && (
          <div role="alert" style={{ color: 'red', marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        <button type="submit" disabled={loading || csrfLoading || csrfToken === ''}>
          {loading ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
