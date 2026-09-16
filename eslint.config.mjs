// M32.7.7 — ESLint flat config. Replaces the broken
// `eslint-config-next` CJS hook (which transitively requires
// `@rushstack/eslint-patch`, which fails on ESLint 9.18's new
// module layout). We import the same Next.js rules directly from
// `@next/eslint-plugin-next`'s flat-config exports.
import { FlatCompat } from '@eslint/eslintrc';
import nextPlugin from '@next/eslint-plugin-next';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';

/**
 * Why this file exists:
 * - `eslint-config-next` v15.5.x still ships a CJS index.js that
 *   `require('@rushstack/eslint-patch/modern-module-resolution')` at
 *   load time. ESLint 9.18 reorganised its internals so the patch's
 *   parent-walk never lands on a file the patch recognises, and it
 *   throws "Failed to patch ESLint because the calling module was not
 *   recognized." The patch exists only to remap plugin resolves into
 *   eslint-config-next's deps; flat config doesn't need that.
 * - All the rules we'd lose by dropping eslint-config-next come from
 *   `@next/eslint-plugin-next` (re-exported as `flatConfig.recommended`
 *   and `flatConfig.coreWebVitals`), which is flat-config native.
 * - FlatCompat is included only so future legacy configs can be
 *   bridged if a third-party plugin lags. Currently unused.
 *
 * To extend: add a new config block in the array. Order matters —
 * later entries override earlier ones.
 */

const tsRuleOverrides = {
  // We have many internal helpers intentionally marked unused while
  // a feature is staged. The `_` prefix opt-out keeps the rule useful
  // for catching the rest.
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  // Allow `no-explicit-any` to flag with warn (not error) so existing
  // code can be tightened incrementally without blocking CI.
  '@typescript-eslint/no-explicit-any': 'warn',
  // Allow non-null assertions where the surrounding code already
  // proves the value. We have many `as` casts in legacy places; flag
  // new ones with warn.
  '@typescript-eslint/no-non-null-assertion': 'warn',
};

const config = [
  // Global ignores — same set the previous flat config used.
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      '.superpowers/**',
      'next-env.d.ts',
      // Generated / checkout scratch — not source.
      '**/*.d.ts',
      'test/**',
      'testgit/**',
      'testjson/**',
      'reports/**',
      // One-off debug scripts that shouldn't be linted.
      'scripts/_tmp-*.mjs',
      'scripts/debug-*.mjs',
      'scripts/debug-*.mts',
      'scripts/probe-*.mts',
      'scripts/check-*.mts',
      'scripts/repro-*.mjs',
      'scripts/create-*.mts',
      'scripts/verify-*.mjs',
      'scripts/verify-*.ts',
      'scripts/smoke-*.mjs',
      'scripts/test-*.mjs',
      'scripts/e2e-api-fixture-verify.mjs',
      'scripts/gen-fixture-repos.mjs',
      'scripts/inspect-error-page.mjs',
      'scripts/list-tokens.mts',
      'scripts/query-100-repos.mjs',
      'scripts/enqueue-30-jobs.mts',
    ],
  },

  // Next.js recommended + core web vitals.
  nextPlugin.flatConfig.recommended,
  nextPlugin.flatConfig.coreWebVitals,

  // React + hooks + a11y + import resolution.
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser globals — pages and 'use client' components.
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        // Node globals — server components, scripts, tests.
        process: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts', '.cjs', '.cts'] },
      },
    },
    rules: {
      // eslint-config-next defaults — keep them on.
      'react/no-unknown-property': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Next.js likes forwardRef but our hooks-based patterns don't
      // hit it; leave the recommended rule off so legacy components
      // without refs don't trip CI.
      'react/display-name': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/alt-text': ['warn', { elements: ['img'] }],
      'jsx-a11y/anchor-has-content': 'warn',
      'import/no-anonymous-default-export': 'warn',
      'import/order': 'off',
    },
  },

  // TypeScript-specific block — needs its own parser.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsRuleOverrides,
    },
  },

  // Test files — relax some rules.
  {
    files: [
      'tests/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.test-helpers.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },

  // ESLint flatCompat shim retained for future legacy plugins.
  // Currently unused, kept so adding `FlatCompat` imports is the only
  // step needed when bridging a non-flat plugin.
  ...new FlatCompat({ baseDirectory: import.meta.dirname }).config({}),
];

export default config;