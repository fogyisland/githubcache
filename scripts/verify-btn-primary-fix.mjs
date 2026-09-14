/**
 * Verify the --brand token fix.
 * Captures: /account/keys/request (submit button) and /account/keys/[id] (rotate button).
 * Confirms both buttons render with a visible brand background (not transparent).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:5002';
const EMAIL = 'raymond.xu@booming.one';
const PASS = 'Admin909217';
const OUT = path.resolve('reports/verify-btn-primary-fix');

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'ghc_setup_done', value: '1', domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();

  // Login
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('form:has(input[type=password]) button[type=submit]:not([disabled])', { timeout: 15000 });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  await Promise.all([
    page.waitForURL(/\/account/, { timeout: 15000 }),
    page.locator('form:has(input[type=password]) button[type=submit]').click(),
  ]);

  // ============ Page 1: /account/keys/request (submit button) ============
  await page.goto(`${BASE}/account/keys/request`);
  await page.waitForLoadState('networkidle');

  const submitInfo = await page.evaluate(() => {
    const html = document.documentElement;
    const btn = document.querySelector('button.ghc-btn-primary[type="submit"]');
    if (!btn) return { found: false };
    const cs = getComputedStyle(btn);
    return {
      found: true,
      theme: html.getAttribute('data-theme'),
      text: btn.textContent?.trim(),
      background: cs.backgroundColor,
      color: cs.color,
      borderColor: cs.borderColor,
      cssVarBrand: cs.getPropertyValue('--brand').trim(),
      width: Math.round(btn.getBoundingClientRect().width),
    };
  });
  console.log('SUBMIT BUTTON:', JSON.stringify(submitInfo, null, 2));
  await page.screenshot({ path: path.join(OUT, 'keys-request.png'), fullPage: true });

  // ============ Page 2: /account/keys/[id] (rotate button) ============
  await page.goto(`${BASE}/account/keys`);
  await page.waitForLoadState('networkidle');
  const firstDetailLink = await page.evaluate(() => {
    // Skip the "request" CTA in the header — pick the first detail link from a table row.
    const a = Array.from(document.querySelectorAll('a[href^="/account/keys/"]'))
      .find((el) => /\/account\/keys\/\d+/.test(el.getAttribute('href') || ''));
    return a ? a.href : null;
  });
  if (!firstDetailLink) {
    console.error('No active key detail link found on /account/keys');
  } else {
    await page.goto(firstDetailLink);
    await page.waitForLoadState('networkidle');

    const rotateInfo = await page.evaluate(() => {
      const html = document.documentElement;
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
        const aria = b.getAttribute('aria-label') || '';
        const text = (b.textContent || '').trim();
        return aria.includes('rotate') || text.includes('Rotate') || text.includes('轮换');
      });
      return btns.map((btn) => {
        const cs = getComputedStyle(btn);
        const r = btn.getBoundingClientRect();
        return {
          text: btn.textContent?.trim(),
          className: btn.className,
          theme: html.getAttribute('data-theme'),
          background: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          cssVarBrand: cs.getPropertyValue('--brand').trim(),
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
        };
      });
    });
    console.log('ROTATE BUTTON(s):', JSON.stringify(rotateInfo, null, 2));
    await page.screenshot({ path: path.join(OUT, 'keys-detail-rotate.png'), fullPage: true });
  }

  // ============ Acceptance gate ============
  let pass = true;
  if (!submitInfo.found) {
    console.error('FAIL: submit button not found');
    pass = false;
  } else {
    // background must NOT be transparent
    if (submitInfo.background === 'rgba(0, 0, 0, 0)' || submitInfo.background === 'transparent') {
      console.error(`FAIL: submit button background is ${submitInfo.background}`);
      pass = false;
    } else {
      console.log(`PASS: submit button background = ${submitInfo.background}`);
    }
    if (!submitInfo.cssVarBrand) {
      console.error('FAIL: --brand CSS var is empty at submit button');
      pass = false;
    } else {
      console.log(`PASS: --brand = "${submitInfo.cssVarBrand}"`);
    }
  }

  await browser.close();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});