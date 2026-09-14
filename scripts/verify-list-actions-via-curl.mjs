/**
 * Like verify-list-actions.mjs but seeds the browser session via curl
 * cookies — avoids the login throttle (which locks Playwright out at
 * 5 attempts / 15 min).
 *
 *   node scripts/verify-list-actions-via-curl.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://localhost:5002';
const EMAIL = 'raymond.xu@booming.one';
const PASS = 'Admin909217';
const OUT = path.resolve('reports/verify-list-actions');

async function main() {
  await mkdir(OUT, { recursive: true });
  const cookieJar = path.join(OUT, 'cookies.txt');
  // Pre-seed Netscape cookie jar with setup_done so middleware lets us through.
  writeFileSync(
    cookieJar,
    `# Netscape HTTP Cookie File\n` +
    `# https://curl.haxx.se/rfc/cookie-spec.html\n` +
    `localhost\tFALSE\t/\tFALSE\t0\tghc_setup_done\t1\n`,
  );

  // get csrf
  execSync(`curl -sS -c "${cookieJar}" -b "${cookieJar}" ${BASE}/api/admin/auth/csrf -o "${OUT}/csrf.json"`, { stdio: 'inherit' });
  const csrfJson = JSON.parse(readFileSync(path.join(OUT, 'csrf.json'), 'utf8'));
  const csrfToken = csrfJson.csrfToken;
  console.log('csrf:', csrfToken.slice(0, 8) + '…');

  // Write login body to file (avoids shell escaping / $ issues)
  writeFileSync(
    path.join(OUT, 'login.json'),
    JSON.stringify({ email: EMAIL, password: PASS, csrf: csrfToken }),
  );

  const loginOut = execSync(
    `curl -sS -c "${cookieJar}" -b "${cookieJar}" -X POST ` +
    `-H "content-type: application/json" ` +
    `-H "x-csrf-token: ${csrfToken}" ` +
    `--data @${OUT}/login.json ` +
    `${BASE}/api/admin/auth/login`,
    { encoding: 'utf8' },
  );
  console.log('login:', loginOut.slice(0, 120));
  if (!loginOut.includes('"ok":true')) {
    throw new Error(`login failed: ${loginOut}`);
  }
  try { unlinkSync(path.join(OUT, 'csrf.json')); } catch {}
  try { unlinkSync(path.join(OUT, 'login.json')); } catch {}

  // Parse Netscape cookies.txt — handle #HttpOnly_ prefix (libcurl style).
  const cookieFile = readFileSync(cookieJar, 'utf8');
  const cookies = cookieFile.split('\n')
    .filter(l => l && !l.startsWith('# '))
    .map(l => {
      let httpOnly = false;
      if (l.startsWith('#HttpOnly_')) {
        httpOnly = true;
        l = l.slice('#HttpOnly_'.length);
      }
      const parts = l.split('\t').map(s => s.replace(/\r/g, ''));
      return {
        domain: parts[0],
        path: parts[2] || '/',
        name: parts[5],
        value: parts[6],
        expires: Number(parts[4]) || -1,
        secure: parts[3] === 'TRUE',
        httpOnly,
      };
    })
    .filter(c => c.name);
  console.log('cookies:', cookies.map(c => c.name + '=' + c.value.slice(0, 8) + '…').join(' '));
  cookies.forEach(c => console.log('  ', JSON.stringify(c)));

  // 2. Use Playwright with these cookies
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addCookies(cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly,
    ...(c.expires > 0 ? { expires: c.expires } : {}),
  })));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/account/keys`);
  await page.waitForLoadState('networkidle');

  const copyBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.ghc-btn-secondary.ghc-btn-sm'));
    return btns
      .filter((b) => /复制|Copy/i.test(b.textContent || ''))
      .map((b) => ({
        text: b.textContent?.trim(),
        disabled: b.disabled,
        ariaLabel: b.getAttribute('aria-label'),
      }));
  });
  console.log('Copy buttons:', JSON.stringify(copyBtns, null, 2));

  const rotateLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a.ghc-btn-secondary.ghc-btn-sm'));
    return links
      .filter((a) => /轮换|Rotate/i.test(a.textContent || ''))
      .map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute('href') }));
  });
  console.log('Rotate links:', JSON.stringify(rotateLinks, null, 2));

  await page.screenshot({ path: path.join(OUT, 'list.png'), fullPage: true });

  const firstCopy = page.locator('button[aria-label^="复制 API key"]:not([disabled])').first();
  const enabled = await firstCopy.count();
  page.on('response', r => {
    if (r.url().includes('localhost:5002')) {
      console.log('  net', r.status(), r.request().method(), r.url().slice(0, 90));
    }
  });
  page.on('console', m => console.log('  console.' + m.type() + ':', m.text().slice(0, 200)));
  if (enabled > 0) {
    console.log('Clicking first enabled Copy button...');
    // Inspect the actual button element first
    const btnInfo = await firstCopy.evaluate((b) => ({
      disabled: b.disabled,
      hasOnClick: typeof b.onclick,
      text: b.textContent?.trim(),
      parentClass: b.parentElement?.className,
      ariaBusy: b.getAttribute('aria-busy'),
    }));
    console.log('Button at click time:', btnInfo);
    await firstCopy.click();
    // Watch for any pending state change
    await page.waitForTimeout(500);
    const pendingMid = await firstCopy.evaluate((b) => ({
      disabled: b.disabled, ariaBusy: b.getAttribute('aria-busy'),
      text: b.textContent?.trim(),
    }));
    console.log('Button 500ms after click:', pendingMid);
    await page.waitForTimeout(2500);
    const clip1 = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    console.log('Clipboard after 1st Copy:', JSON.stringify(clip1));

    // Click again immediately to verify NO cooldown
    console.log('Clicking 2nd time (no-cooldown check)...');
    await firstCopy.click();
    await page.waitForTimeout(2500);
    const clip2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    console.log('Clipboard after 2nd Copy:', JSON.stringify(clip2));

    if (clip1 && clip2 && clip1 === clip2) {
      console.log('✅ NO COOLDOWN confirmed: rapid 2 clicks both succeed');
    } else if (clip1 && !clip2) {
      console.log('⚠️  2nd click failed (clipboard empty) — may have hit an error');
    } else {
      console.log('❌ Cooldown or failure detected');
    }

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