import { chromium } from 'playwright';

const BASE = 'http://localhost:5002';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  await context.addCookies([
    { name: 'ghc_setup_done', value: '1', domain: 'localhost', path: '/' },
  ]);
  const page = await context.newPage();

  // log in first
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form:has(input[type=password]) button[type=submit]:not([disabled])', { timeout: 15000 });
  await page.fill('input[type=email]', 'raymond.xu@booming.one');
  await page.fill('input[type=password]', 'Admin909217');
  await page.locator('form:has(input[type=password]) button[type=submit]').click();
  await page.waitForURL(/\/account/, { timeout: 15000 });

  // inject a window.onerror to capture richer info
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => {
      window.__errs.push({
        msg: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack ?? '',
      });
    });
    window.addEventListener('unhandledrejection', (e) => {
      window.__errs.push({
        msg: `unhandledrejection: ${String(e.reason)}`,
        stack: e.reason?.stack ?? '',
      });
    });
  });

  page.on('pageerror', (err) => {
    console.log(`[pageerror] message=${JSON.stringify(err.message)}`);
    console.log(`[pageerror] stack=${err.stack?.split('\n').slice(0, 10).join(' | ')}`);
  });

  await page.goto(`${BASE}/admin/providers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const errs = await page.evaluate(() => window.__errs);
  console.log(`[probe] window-level errors: ${errs.length}`);
  for (const e of errs) console.log(JSON.stringify(e, null, 2));

  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });