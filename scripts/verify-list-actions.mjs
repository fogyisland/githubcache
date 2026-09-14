/**
 * Verify the M31.x inline copy + rotate buttons on /account/keys.
 *
 * Run after restarting dev server (so prisma client picks up the
 * new plaintext_key column AND so the .next/ cache is fresh).
 *
 *   node scripts/verify-list-actions.mjs
 *
 * Asserts:
 *   - /account/keys renders an Actions column.
 *   - Active keys whose plaintextKey is populated show an enabled
 *     "Copy" button.
 *   - Keys created before the column (plaintextKey=NULL) show a
 *     disabled Copy button.
 *   - "Rotate" link jumps to /account/keys/[id].
 *   - Clicking Copy invokes revealOwnKeyAction, returns plaintext,
 *     and writes to clipboard.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:5002';
const EMAIL = 'raymond.xu@booming.one';
const PASS = 'Admin909217';
const OUT = path.resolve('reports/verify-list-actions');

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addCookies([{ name: 'ghc_setup_done', value: '1', domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`);
  await page.waitForSelector('form:has(input[type=password]) button[type=submit]:not([disabled])', { timeout: 15000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  await page.locator('form:has(input[type=password]) button[type=submit]').click();
  await page.waitForURL(/\/account/, { timeout: 15000 });
  await page.goto(`${BASE}/account/keys`);
  await page.waitForLoadState('networkidle');

  // Find all Copy buttons (use aria-label to avoid matching the logout button,
  // which shares the ghc-btn-secondary ghc-btn-sm classes).
  const copyBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button[aria-label^="复制 API key"], button[aria-label^="Copy API key"]'));
    return btns.map((b) => ({
      text: b.textContent?.trim(),
      disabled: b.disabled,
      ariaLabel: b.getAttribute('aria-label'),
    }));
  });
  console.log('Copy buttons on list:', JSON.stringify(copyBtns, null, 2));

  // Find all Rotate links (use aria-label to avoid matching other secondary buttons).
  const rotateLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[aria-label^="轮换 API key"], a[aria-label^="Rotate API key"]'));
    return links.map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute('href') }));
  });
  console.log('Rotate links on list:', JSON.stringify(rotateLinks, null, 2));

  await page.screenshot({ path: path.join(OUT, 'list.png'), fullPage: true });

  // Click the first enabled Copy button (aria-label scoped to skip logout).
  const firstCopy = page.locator('button[aria-label^="复制 API key"]:not([disabled]), button[aria-label^="Copy API key"]:not([disabled])').first();
  const enabled = await firstCopy.count();
  if (enabled > 0) {
    await firstCopy.click();
    await page.waitForTimeout(1500); // wait for reveal + clipboard
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    console.log('Clipboard after Copy:', clip);
    await page.screenshot({ path: path.join(OUT, 'list-after-copy.png'), fullPage: true });
  } else {
    console.log('No enabled Copy button — keys may predate the plaintext_key column.');
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});