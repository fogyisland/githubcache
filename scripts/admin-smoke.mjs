/**
 * Admin smoke scan — log in as the real admin, visit every /admin/* page,
 * capture screenshots + console errors + page errors + selector misses.
 * Used by the M30.7 manual smoke gate to find regressions without
 * manual clicking.
 *
 * Usage:
 *   AUDIT_ADMIN_EMAIL=raymond.xu@booming.one AUDIT_ADMIN_PASS=Admin909217 \
 *     node scripts/admin-smoke.mjs
 *
 * Output:
 *   reports/admin-smoke/<slug>.png        one per page
 *   reports/admin-smoke/summary.json      one row per page (status, errors)
 *   reports/admin-smoke/console/<slug>.log all browser console + page errors
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.AUDIT_ADMIN_EMAIL ?? 'raymond.xu@booming.one';
const PASS = process.env.AUDIT_ADMIN_PASS ?? 'Admin909217';
const OUT_DIR = path.resolve('reports/admin-smoke');
const CONSOLE_DIR = path.join(OUT_DIR, 'console');

const PAGES = [
  { slug: 'dashboard',   path: '/admin' },
  { slug: 'users',       path: '/admin/users' },
  { slug: 'api-keys',    path: '/admin/api-keys' },
  { slug: 'github-tokens', path: '/admin/github-tokens' },
  { slug: 'repositories', path: '/admin/repositories' },
  { slug: 'ingestion',   path: '/admin/ingestion' },
  { slug: 'queries',     path: '/admin/queries' },
  { slug: 'insights',    path: '/admin/insights' },
  { slug: 'queue',       path: '/admin/queue' },
  { slug: 'refresh',     path: '/admin/refresh' },
  { slug: 'audit',       path: '/admin/audit' },
  { slug: 'email',       path: '/admin/email' },
  { slug: 'reports',     path: '/admin/reports' },
  { slug: 'webhooks',    path: '/admin/webhooks' },
  { slug: 'database',    path: '/admin/database' },
  { slug: 'api-settings', path: '/admin/api-settings' },
  { slug: 'providers',   path: '/admin/providers' },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CONSOLE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  // The setup wizard sets `ghc_setup_done=1` after migrations + admin
  // bootstrap. In dev we skip the wizard (DB is already seeded), so we
  // set the cookie ourselves to bypass the middleware gate.
  await context.addCookies([
    {
      name: 'ghc_setup_done',
      value: '1',
      domain: new URL(BASE).hostname,
      path: '/',
    },
  ]);
  const page = await context.newPage();

  const consoleLogs = []; // collected globally then split per page
  page.on('console', (msg) => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    });
  });
  page.on('pageerror', (err) => {
    consoleLogs.push({
      type: 'pageerror',
      text: err.message,
      stack: err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : '',
    });
  });

  // 1. Log in.
  console.log(`[smoke] navigating to ${BASE}/login`);
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // Wait for hydration + CSRF fetch to complete (button becomes enabled).
  await page.waitForSelector('form:has(input[type=password]) button[type=submit]:not([disabled])', { timeout: 15000, state: 'attached' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  page.on('response', (resp) => {
    if (resp.url().includes('/api/admin/auth/login')) {
      console.log(`[smoke] login response: ${resp.status()} ${resp.url()}`);
    }
  });
  // Surface any login-form error so we know why a redirect didn't happen.
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser error]`, msg.text());
  });
  await page.locator('form:has(input[type=password]) button[type=submit]').click();
  await page.waitForURL(/\/account/, { timeout: 15000 });
  console.log(`[smoke] logged in as ${EMAIL}`);

  // 2. Visit each page, snapshot + flush console logs.
  const summary = [];
  for (const target of PAGES) {
    const before = consoleLogs.length;
    const consoleFile = path.join(CONSOLE_DIR, `${target.slug}.log`);
    const screenshot = path.join(OUT_DIR, `${target.slug}.png`);
    let status = 'ok';
    let httpStatus = null;
    let url = null;

    try {
      const resp = await page.goto(`${BASE}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      httpStatus = resp?.status() ?? null;
      url = page.url();
      // Give the client a moment to hydrate before screenshot.
      await page.waitForTimeout(800);
      await page.screenshot({ path: screenshot, fullPage: true });
    } catch (err) {
      status = 'navigation-error';
      consoleLogs.push({ type: 'nav-error', text: err.message });
    }

    const pageLogs = consoleLogs.slice(before);
    const errors = pageLogs.filter(
      (l) => l.type === 'error' || l.type === 'pageerror' || l.type === 'nav-error',
    );
    if (errors.length > 0 && status === 'ok') status = 'console-errors';

    await writeFile(consoleFile, pageLogs.map((l) => `[${l.type}] ${l.text}`).join('\n') || '(no console output)');

    summary.push({
      slug: target.slug,
      path: target.path,
      status,
      httpStatus,
      url,
      screenshot: path.relative(process.cwd(), screenshot),
      consoleLog: path.relative(process.cwd(), consoleFile),
      errorCount: errors.length,
      errors: errors.map((e) => `[${e.type}] ${e.text}`).slice(0, 5),
    });
    console.log(`[smoke] ${target.slug.padEnd(14)} ${status.padEnd(20)} http=${httpStatus} errors=${errors.length}`);
  }

  await writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const totalErrors = summary.reduce((s, r) => s + r.errorCount, 0);
  const failed = summary.filter((r) => r.status !== 'ok');
  console.log(`\n[smoke] DONE — ${summary.length} pages, ${failed.length} with issues, ${totalErrors} total errors`);

  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] FATAL:', err);
  process.exit(2);
});