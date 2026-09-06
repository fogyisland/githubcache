import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Mock next-intl/server to return a function that looks up keys in a dict.
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      login: {
        eyebrow: 'github metadata cache',
        title: 'Sign in',
        tagline: 'Manage tokens, schedule refreshes, audit requests.',
        backToHome: '← Back to home',
      },
    };
    return (key: string, values?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && values) {
        return v.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
      }
      return v ?? key;
    };
  },
}));

// Mock next-intl to return a function that looks up keys in a dict.
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const dicts: Record<string, Record<string, string>> = {
      'login.form': {
        email: 'Email',
        password: 'Password',
        submit: 'Log in',
        submitting: 'Logging in…',
        csrfInitFailed: 'Failed to initialize CSRF token. Please refresh.',
        networkError: 'Network error. Please try again.',
        loginFailed: 'Login failed',
      },
      'login.form.error': {
        csrf: 'Your session expired. Please refresh the page and try again.',
        invalid_body: 'Invalid request. Please refresh and try again.',
        too_many_attempts:
          'Too many login attempts. Try again in {seconds} seconds.',
        invalid_credentials: 'Email or password is incorrect.',
        account_disabled: 'Your account has been disabled. Contact an administrator.',
      },
    };
    return (key: string, values?: Record<string, string | number>) => {
      const v = dicts[ns]?.[key];
      if (v && values) {
        return v.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));
      }
      return v ?? key;
    };
  },
}));

import LoginPage from '@/app/login/page';
import { LoginForm, translateError } from '@/app/login/_login-form';

describe('LoginPage i18n', () => {
  it('renders translated page chrome (eyebrow, title, tagline, backToHome)', async () => {
    const html = renderToStaticMarkup(await LoginPage());
    expect(html).toContain('github metadata cache');
    expect(html).toContain('Sign in');
    expect(html).toContain('Manage tokens, schedule refreshes, audit requests.');
    expect(html).toContain('← Back to home');
  });
});

describe('LoginForm i18n', () => {
  it('renders translated labels (email, password) and submit button text', async () => {
    const html = renderToStaticMarkup(createElement(LoginForm));
    expect(html).toContain('Email');
    expect(html).toContain('Password');
    expect(html).toContain('Log in');
  });
});

describe('translateError helper', () => {
  it('maps each known error code to the matching translation key', () => {
    const tErr = vi.fn(
      (k: string, v?: Record<string, string | number>) =>
        `[${k}${v ? JSON.stringify(v) : ''}]`,
    );
    const tForm = vi.fn((k: string) => `[form:${k}]`);

    // csrf
    expect(translateError('csrf', null, tErr, tForm)).toBe('[csrf]');
    // invalid_body
    expect(translateError('invalid_body', null, tErr, tForm)).toBe(
      '[invalid_body]',
    );
    // too_many_attempts with explicit retry-after
    expect(translateError('too_many_attempts', '120', tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":120}]',
    );
    // too_many_attempts without retry-after (defaults to 60)
    expect(translateError('too_many_attempts', null, tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":60}]',
    );
    // too_many_attempts with invalid retry-after (NaN — falls back to 60)
    expect(translateError('too_many_attempts', 'abc', tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":60}]',
    );
    // invalid_credentials
    expect(translateError('invalid_credentials', null, tErr, tForm)).toBe(
      '[invalid_credentials]',
    );
    // account_disabled
    expect(translateError('account_disabled', null, tErr, tForm)).toBe(
      '[account_disabled]',
    );
  });

  it('falls through to loginFailed for unknown or missing error codes', () => {
    const tErr = vi.fn(
      (k: string, v?: Record<string, string | number>) =>
        `[${k}${v ? JSON.stringify(v) : ''}]`,
    );
    const tForm = vi.fn((k: string) => `[form:${k}]`);

    // undefined code
    expect(translateError(undefined, null, tErr, tForm)).toBe(
      '[form:loginFailed]',
    );
    // unknown code
    expect(translateError('some_new_code', null, tErr, tForm)).toBe(
      '[form:loginFailed]',
    );
    // empty string
    expect(translateError('', null, tErr, tForm)).toBe('[form:loginFailed]');
  });

  it('passes a finite positive seconds value to tErr for too_many_attempts', () => {
    const tErr = vi.fn(
      (k: string, v?: Record<string, string | number>) =>
        `[${k}${v ? JSON.stringify(v) : ''}]`,
    );
    const tForm = vi.fn((k: string) => `[form:${k}]`);

    // negative value should fall back to 60
    expect(translateError('too_many_attempts', '-5', tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":60}]',
    );
    // zero should fall back to 60
    expect(translateError('too_many_attempts', '0', tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":60}]',
    );
    // 30 → 30
    expect(translateError('too_many_attempts', '30', tErr, tForm)).toBe(
      '[too_many_attempts{"seconds":30}]',
    );
  });
});
