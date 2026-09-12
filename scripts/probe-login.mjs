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
  page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('request', (req) => {
    if (req.url().includes('/api/admin/auth/')) console.log(`[req] ${req.method()} ${req.url()}`);
  });
  page.on('response', (resp) => {
    if (resp.url().includes('/api/admin/auth/')) console.log(`[resp] ${resp.status()} ${resp.url()}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  console.log('[probe] landed on', page.url());
  const btnState = await page.evaluate(() => {
    const f = document.querySelector('form:has(input[type=password])');
    const b = f?.querySelector('button[type=submit]');
    return { disabled: b?.disabled, html: b?.outerHTML?.slice(0, 200) };
  });
  console.log('[probe] submit button:', JSON.stringify(btnState, null, 2));

  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });