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

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form:has(input[type=password]) button[type=submit]:not([disabled])', { timeout: 15000 });
  await page.fill('input[type=email]', 'raymond.xu@booming.one');
  await page.fill('input[type=password]', 'Admin909217');
  await page.locator('form:has(input[type=password]) button[type=submit]').click();
  await page.waitForURL(/\/account/, { timeout: 15000 });

  // Log every console message verbatim and every pageerror with stack.
  page.on('console', (msg) => {
    console.log(`[console ${msg.type()}]`, msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => {
    console.log('=========== pageerror ===========');
    console.log('message:', err.message);
    console.log('name:', err.name);
    console.log('stack:', err.stack);
    console.log('==================================');
  });
  page.on('requestfailed', (req) => {
    console.log(`[reqfail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  console.log('--- navigating to /admin/providers ---');
  await page.goto(`${BASE}/admin/providers`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });