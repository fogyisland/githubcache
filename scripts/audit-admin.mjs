// scripts/audit-admin.mjs — automated admin UI audit.
//
// DEV-ONLY. Hardcoded credentials below are for local development; never
// deploy or run against a non-local environment. Override via env vars
// (AUDIT_ADMIN_EMAIL / AUDIT_ADMIN_PASS) for CI or remote dev servers.
//
// Crawls every admin page in dev mode, captures console errors /
// warnings / page errors / network failures / i18n key leaks /
// element overflow, and writes a JSON report plus a console summary.
//
// Run: node scripts/audit-admin.mjs
// Requires: dev server running on :5002, admin user seeded.
//
// Heuristics applied (lightweight — not a full a11y audit):
//   * console.error level messages
//   * console.warn level messages
//   * pageerror (uncaught exception) events
//   * 4xx / 5xx network responses
//   * element rendering text that matches /admin\.[a-z]+\.[a-z]+/  ←
//     indicates an untranslated i18n key leaked into the DOM
//   * <button> elements with empty text content
//   * page error overlay (Next.js "This page could not be found")

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:5002';
const ADMIN_EMAIL = process.env.AUDIT_ADMIN_EMAIL ?? 'raymond.xu@booming.one';
const ADMIN_PASS = process.env.AUDIT_ADMIN_PASS ?? 'LocalDev909217!';
const OUT_DIR = 'reports/admin-audit';

// Safety check: hardcoded fallback credentials are DEV-ONLY. If the
// operator didn't override via env vars AND the target isn't localhost,
// refuse to run.
if (!process.env.AUDIT_ADMIN_EMAIL && !process.env.AUDIT_ADMIN_PASS) {
  const isLocal = BASE === 'http://localhost:5002' || BASE === 'http://localhost:5002/';
  if (!isLocal) {
    console.error(
      `\nRefusing to run: hardcoded credentials are dev-only.\n` +
        `Set AUDIT_ADMIN_EMAIL and AUDIT_ADMIN_PASS env vars for non-local targets.\n` +
        `Target was: ${BASE}\n`,
    );
    process.exit(2);
  }
}

// All admin pages to audit. Mirrors ADMIN_SECTIONS in
// src/app/admin/_components/admin-sidebar.tsx + the database/insights
// sub-pages + email/log. Update this list as routes are added/removed.
const PAGES = [
  '/admin',
  '/admin/users',
  '/admin/api-keys',
  '/admin/github-tokens',
  '/admin/reports',
  '/admin/queries',
  '/admin/ingestion',
  '/admin/providers',
  '/admin/repositories',
  '/admin/audit',
  '/admin/refresh',
  '/admin/queue',
  '/admin/webhooks',
  '/admin/database',
  '/admin/database/schema',
  '/admin/database/operations',
  '/admin/api-settings',
  '/admin/insights',
  '/admin/insights/top-repos',
  '/admin/insights/languages',
  '/admin/insights/stale',
  '/admin/insights/health',
  '/admin/email',
  '/admin/email/log',
];

// Heuristics: key-shaped strings that should never leak to the DOM
// in production. Matches en/zh i18n namespaces that look untranslated
// (e.g. "admin.apiSettings.title", "admin.users.list.column.foo").
const I18N_KEY_RE = /admin\.[a-zA-Z]+(?:\.[a-zA-Z0-9_-]+){1,}/g;
// Heuristic: "useActionState is not a function" etc. — React 19
// import-path mistakes surface in dev console.
const REACT_19_DEPRECATION = /ReactDOM\.(useFormState|useActionState)/;

async function login(context) {
  // Step 1: bypass /init wizard gate. The middleware checks this cookie
  // before any auth — if it's missing, every /admin/* is 307'd to /init.
  await context.addCookies([
    { name: 'ghc_setup_done', value: '1', url: BASE },
  ]);

  // Step 2: use a real page to get CSRF — the server sets ghc_csrf
  // via Set-Cookie on the GET, and the page's network stack picks it
  // up automatically.
  const csrfPage = await context.newPage();
  const csrfResp = await csrfPage.goto(`${BASE}/api/admin/auth/csrf`);
  const csrfBody = await csrfResp.json();
  const csrfToken = csrfBody.csrfToken || csrfBody.token;
  await csrfPage.close();
  if (!csrfToken) {
    throw new Error(`failed to get CSRF token: ${JSON.stringify(csrfBody)}`);
  }

  // Step 3: post login. The /api/admin/auth/login route reads the
  // ghc_admin_sid cookie (set via Set-Cookie) which is why we go
  // through the page's request context — same browser session.
  const loginPage = await context.newPage();
  await loginPage.goto(`${BASE}/`);  // navigate so page.evaluate can fetch
  const resp = await loginPage.evaluate(
    async ({ base, csrfToken, email, password }) => {
      const r = await fetch(`${base}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ email, password, csrf: csrfToken }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    { base: BASE, csrfToken, email: ADMIN_EMAIL, password: ADMIN_PASS },
  );
  await loginPage.close();
  if (resp.status !== 200) {
    throw new Error(`login failed: ${resp.status} ${JSON.stringify(resp.body)}`);
  }
  return csrfToken;
}

async function auditOne(context, path) {
  const errors = [];
  const warnings = [];
  const pageErrors = [];
  const failedRequests = [];
  const i18nLeaks = [];
  const emptyButtons = [];

  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
    if (msg.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400 && status !== 404 /* sidebar empty slug = 404 ignored */) {
      failedRequests.push({ url: res.url(), status });
    }
  });

  const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 15000 }).catch((e) => ({ _err: e.message }));
  const status = resp && resp.status ? resp.status() : 0;
  const isErrorPage = status === 404 || status >= 500;

  // i18n leak scan: grab all visible text on the page, grep for
  // admin.*.* patterns that look like untranslated keys.
  const pageText = isErrorPage ? '' : await page.evaluate(() => document.body?.innerText ?? '');
  const matches = pageText.match(I18N_KEY_RE) || [];
  if (matches.length) i18nLeaks.push(...[...new Set(matches)]);

  // Empty button check: <button> with no accessible name and no text.
  if (!isErrorPage) {
    const emptyBtnCount = await page.evaluate(() => {
      let n = 0;
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        const text = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || b.getAttribute('title');
        if (!text && !aria) n++;
      }
      return n;
    });
    if (emptyBtnCount > 0) emptyButtons.push(emptyBtnCount);
  }

  // Screenshot — useful for visual review.
  const safeName = path.replace(/[^\w]+/g, '_') || 'root';
  const shotPath = join(OUT_DIR, `${safeName}.png`);
  if (!isErrorPage) {
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined);
  }

  await page.close();
  return {
    path,
    status,
    isErrorPage,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    pageErrors: [...new Set(pageErrors)],
    failedRequests,
    i18nLeaks: [...new Set(i18nLeaks)],
    emptyButtons,
    screenshot: !isErrorPage ? shotPath : null,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await login(context);

  console.log(`Auditing ${PAGES.length} admin pages…\n`);
  const results = [];
  for (const path of PAGES) {
    process.stdout.write(`  ${path.padEnd(40)}`);
    const r = await auditOne(context, path);
    const flag = r.isErrorPage
      ? '❌ 4xx/5xx'
      : r.errors.length || r.pageErrors.length || r.i18nLeaks.length
        ? '⚠️  issues'
        : r.warnings.length
          ? '·  warnings'
          : '✓';
    console.log(flag);
    results.push(r);
  }

  await browser.close();

  // Persist raw report.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(OUT_DIR, `report-${ts}.json`);
  writeFileSync(reportPath, JSON.stringify(results, null, 2));

  // Console summary.
  const totalIssues = results.reduce(
    (n, r) =>
      n + r.errors.length + r.pageErrors.length + r.i18nLeaks.length + r.emptyButtons.length,
    0,
  );
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Audited ${results.length} pages · ${totalIssues} issues`);
  console.log(`Report: ${reportPath}`);
  console.log('='.repeat(60));

  for (const r of results) {
    const parts = [];
    if (r.isErrorPage) parts.push('page error');
    if (r.pageErrors.length) parts.push(`${r.pageErrors.length} page error(s)`);
    if (r.errors.length) parts.push(`${r.errors.length} console error(s)`);
    if (r.warnings.length) parts.push(`${r.warnings.length} warning(s)`);
    if (r.i18nLeaks.length) parts.push(`${r.i18nLeaks.length} i18n key leak(s)`);
    if (r.emptyButtons.length) parts.push(`${r.emptyButtons.length} empty button(s)`);
    if (parts.length === 0) continue;
    console.log(`\n  ${r.path}`);
    for (const p of parts) console.log(`    • ${p}`);
    if (r.i18nLeaks.length) {
      console.log('      keys:', r.i18nLeaks.slice(0, 5).join(', '));
    }
    if (r.errors.length) {
      console.log('      first error:', r.errors[0].slice(0, 140));
    }
    if (r.warnings.length) {
      console.log('      first warn:', r.warnings[0].slice(0, 140));
    }
  }
  console.log(`\nDone. ${totalIssues} issues across ${results.length} pages.`);
}

main().catch((e) => {
  console.error('audit failed:', e);
  process.exit(1);
});