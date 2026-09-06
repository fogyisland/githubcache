'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

interface CsrfResponse {
  csrfToken: string;
}

interface LoginResponse {
  ok?: boolean;
  role?: string;
  error?: string;
}

/**
 * Map server error codes (defined in src/app/api/admin/auth/login/route.ts)
 * to translation keys under `login.form.error.*`.
 */
type ServerErrorCode =
  | 'csrf'
  | 'invalid_body'
  | 'too_many_attempts'
  | 'invalid_credentials'
  | 'account_disabled';

const RETRY_AFTER_HEADER = 'retry-after';

/**
 * Translate a server error code into a localized message.
 * - Known codes map to `login.form.error.<code>` keys.
 * - Unknown codes fall through to `login.form.loginFailed`.
 * - `too_many_attempts` interpolates the Retry-After seconds if present.
 *
 * Kept as a free function (not a hook) so the test can drive it directly.
 */
export function translateError(
  code: string | undefined,
  retryAfter: string | null,
  tErr: (key: string, values?: Record<string, string | number>) => string,
  tForm: (key: string) => string,
): string {
  if (!code) return tForm('loginFailed');
  const known: readonly ServerErrorCode[] = [
    'csrf',
    'invalid_body',
    'too_many_attempts',
    'invalid_credentials',
    'account_disabled',
  ] as const;
  if (known.includes(code as ServerErrorCode)) {
    if (code === 'too_many_attempts') {
      const seconds = retryAfter ? Number(retryAfter) : 60;
      return tErr(code, {
        seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
      });
    }
    return tErr(code);
  }
  return tForm('loginFailed');
}

/**
 * Client-side login form.
 *
 * CSRF flow (double-submit cookie):
 *   1. On mount, GET /api/admin/auth/csrf — sets the `ghc_csrf` cookie AND
 *      returns the token in the body so JS can echo it in the header.
 *   2. On submit, POST /api/admin/auth/login with the token in both the
 *      `x-csrf-token` header (checked by middleware + route) and the body
 *      (belt-and-braces; the route's zod schema requires it).
 *   3. On 200, hard-navigate to /admin so the server component re-reads the
 *      freshly-set session cookie.
 *
 * Visual: themed via ghc-* classes — picks up --color-accent for the submit
 * button and --color-danger for the error alert in all 3 themes.
 */
export function LoginForm(): ReactElement {
  const t = useTranslations('login.form');
  const tErr = useTranslations('login.form.error');
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
        const res = await fetch('/api/admin/auth/csrf', {
          credentials: 'same-origin',
        });
        const body = (await res.json()) as CsrfResponse;
        if (!cancelled) {
          setCsrfToken(body.csrfToken);
          setCsrfLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(t('csrfInitFailed'));
          setCsrfLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

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
        // M26: default to the personal center (/account) for every
        // signed-in user, including admins. Admins still have a
        // visible "Admin center" link in the nav + /account sidebar.
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.href = next && next.startsWith('/') ? next : '/account';
        return;
      }
      setError(
        translateError(
          body.error,
          res.headers.get(RETRY_AFTER_HEADER),
          tErr,
          t,
        ),
      );
    } catch {
      setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('email')}
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="ghc-input"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('password')}
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="ghc-input"
        />
      </div>
      {error !== null && (
        <div role="alert" className="ghc-alert-danger">
          {error}
        </div>
      )}
      <button
        type="submit"
        className="ghc-btn-primary"
        disabled={loading || csrfLoading || csrfToken === ''}
      >
        {loading ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
