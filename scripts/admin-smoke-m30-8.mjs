/**
 * M30.8 Task 7 — automated Playwright smoke for admin sidebar groups.
 *
 * Six verification checks from the design spec:
 *   1. All 5 group headers render (Overview / Access / Data / Operations / System)
 *   2. Click each header — items collapse / re-expand
 *   3. Collapse `system`, navigate to `/admin/email/log` — `system` re-expands
 *      and `Email log` is highlighted
 *   4. Switch role to operator — `Operations` and `System` headers disappear
 *   5. localStorage check: `ghc.admin.sidebar.collapsed` has JSON after first toggle
 *   6. Command palette (Ctrl+K) — still shows all 18 sections flat (no grouping)
 *
 * Usage: node scripts/admin-smoke-m30-8.mjs
 *
 * Requires: dev:server running on :5002, admin + operator users seeded.
 *   Admin:    raymond.xu@booming.one / Admin909217
 *   Operator: operator@smoke.local    / Operator909217
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:5002';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASS = 'change-me-12345678';
const OPERATOR_EMAIL = 'operator@smoke.local';
const OPERATOR_PASS = 'Operator909217';
const OUT_DIR = path.resolve('reports/m30-8-smoke');

const SLUGS = ['overview', 'access', 'data', 'operations', 'system'];

async function login(page, email, password) {
  // The setup wizard sets `ghc_setup_done=1` after migrations + admin
  // bootstrap. In dev we skip the wizard (DB is already seeded), so we
  // set the cookie ourselves to bypass the middleware gate.
  await page.context().addCookies([
    {
      name: 'ghc_setup_done',
      value: '1',
      domain: new URL(BASE).hostname,
      path: '/',
    },
  ]);
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(
    'form:has(input[type=password]) button[type=submit]:not([disabled])',
    { timeout: 15000, state: 'attached' },
  );
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([
    page.waitForURL(/\/account/, { timeout: 15000 }),
    page.locator('form:has(input[type=password]) button[type=submit]').click(),
  ]);
}

async function ensureSidebar(page) {
  await page.waitForSelector('.ghc-admin-sidebar-group', { timeout: 15000 });
}

async function dumpGroupState(page, label) {
  const groups = {};
  for (const slug of SLUGS) {
    const list = await page.$(`#ghc-admin-sidebar-group-${slug}`);
    const btn = await page.$(`[data-group="${slug}"] button`);
    groups[slug] = {
      exists: list !== null && btn !== null,
      listHidden: list ? await list.evaluate((el) => el.hasAttribute('hidden')) : null,
      ariaExpanded: btn ? await btn.getAttribute('aria-expanded') : null,
    };
  }
  return { label, groups };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // NOTE: do NOT set locale: 'zh-CN' — it triggers a Next.js error
    // overlay ("Invalid or unexpected token" pageerror) on the login
    // page that keeps the submit button disabled indefinitely. The
    // default en-US locale works fine.
  });
  const page = await context.newPage();
  // NOTE: All listeners MUST be async (return Promise.resolve()) — a
  // sync listener that calls console.log synchronously BLOCKS the page's
  // microtask queue and the login submit button never enables (verified
  // by isolated repro). Async yields to the event loop.
  page.on('request', async (r) => {
    await Promise.resolve();
    if (r.url().includes('localhost:5002') && !r.url().includes('_next/static')) {
      console.log(`[req] ${r.method()} ${r.url()}`);
    }
  });
  page.on('response', async (r) => {
    await Promise.resolve();
    if (r.url().endsWith('/api/admin/palette')) {
      try {
        const body = await r.json();
        console.log(`[palette] sections=${body.sections?.length ?? 'null'}, indexed=${body.indexed?.length ?? 'null'}, audit=${body.recentAudit?.length ?? 'null'}`);
      } catch (e) {}
    }
  });
  page.on('pageerror', async (err) => {
    await Promise.resolve();
    console.log(`[pageerror]`, err.message.slice(0, 200));
  });

  const results = {};

  // === Login as admin ===
  console.log(`[smoke] login as admin ${ADMIN_EMAIL}`);
  await login(page, ADMIN_EMAIL, ADMIN_PASS);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await ensureSidebar(page);
  await page.waitForTimeout(300); // hydrate localStorage effect

  // ===== Check 1: 5 group headers render =====
  const foundSlugs = [];
  for (const slug of SLUGS) {
    const el = await page.$(`[data-group="${slug}"]`);
    if (el) foundSlugs.push(slug);
  }
  results.check1_render5Groups = {
    pass: foundSlugs.length === 5 && SLUGS.every((s) => foundSlugs.includes(s)),
    found: foundSlugs,
    expected: SLUGS,
  };
  console.log(`[check1] render 5 groups: ${results.check1_render5Groups.pass ? 'PASS' : 'FAIL'} (found ${foundSlugs.join(',')})`);

  // ===== Check 2: click each header collapses/re-expands =====
  // `overview` is force-expanded when on `/admin` (dashboard lives there),
  // so toggling its header does NOT hide its list. Test it for state
  // persistence only. For the collapse/expand visibility assertion use
  // the `access` group instead (no active section under `/admin`).
  const collapseResults = {};
  for (const slug of ['access', 'data', 'operations', 'system']) {
    // Make sure group starts expanded.
    await page.evaluate(() => window.localStorage.removeItem('ghc.admin.sidebar.collapsed'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ensureSidebar(page);
    await page.waitForTimeout(300);

    const headerSel = `[data-group="${slug}"] button`;
    const listSel = `#ghc-admin-sidebar-group-${slug}`;

    // First click → collapsed
    await page.click(headerSel);
    await page.waitForTimeout(150);
    const hiddenAfter1 = await page.$eval(listSel, (el) => el.hasAttribute('hidden'));

    // Second click → re-expanded
    await page.click(headerSel);
    await page.waitForTimeout(150);
    const hiddenAfter2 = await page.$eval(listSel, (el) => el.hasAttribute('hidden'));

    collapseResults[slug] = {
      hiddenAfterFirstClick: hiddenAfter1,
      hiddenAfterSecondClick: hiddenAfter2,
      pass: hiddenAfter1 === true && hiddenAfter2 === false,
    };
  }
  results.check2_collapseExpand = {
    pass: Object.values(collapseResults).every((r) => r.pass),
    details: collapseResults,
  };
  console.log(`[check2] collapse/expand: ${results.check2_collapseExpand.pass ? 'PASS' : 'FAIL'}`);

  // ===== Check 3: collapse system, navigate to /admin/email/log — system re-expands =====
  // Reset localStorage so we have a clean state.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureSidebar(page);
  await page.waitForTimeout(300);

  // Collapse `system` (which contains email-log).
  await page.click('[data-group="system"] button');
  await page.waitForTimeout(150);
  const systemHiddenBeforeNav = await page.$eval('#ghc-admin-sidebar-group-system', (el) => el.hasAttribute('hidden'));

  // Navigate to /admin/email/log
  await page.goto(`${BASE}/admin/email/log`, { waitUntil: 'domcontentloaded' });
  await ensureSidebar(page);
  await page.waitForTimeout(300);

  const systemHiddenAfterNav = await page.$eval('#ghc-admin-sidebar-group-system', (el) => el.hasAttribute('hidden'));
  const emailLogCurrent = await page.$eval(
    '[data-group="system"] a[href="/admin/email/log"]',
    (el) => el.classList.contains('ghc-admin-sidebar-current'),
  ).catch(() => false);

  results.check3_forceExpand = {
    hiddenAfterCollapse: systemHiddenBeforeNav,
    hiddenAfterNavToActive: systemHiddenAfterNav,
    emailLogHighlighted: emailLogCurrent,
    pass: systemHiddenBeforeNav === true && systemHiddenAfterNav === false && emailLogCurrent === true,
  };
  console.log(`[check3] force-expand: ${results.check3_forceExpand.pass ? 'PASS' : 'FAIL'} (hidden after collapse=${systemHiddenBeforeNav}, hidden after nav=${systemHiddenAfterNav}, highlighted=${emailLogCurrent})`);

  // ===== Check 5: localStorage check =====
  // (Run before Check 4 so we still have admin session. Clean slate.)
  // Note: on first mount the component persists `JSON.stringify({})` to
  // localStorage synchronously. So the "before" value may be `"{}"` (the
  // initial empty object) OR `null` if the clear happened before mount.
  // The meaningful assertion is: AFTER toggling, the key contains JSON
  // with `access === true`.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ensureSidebar(page);
  // Wait for the mount-effect that writes initial state to localStorage.
  await page.waitForTimeout(400);

  // Initial value before toggle.
  const beforeToggle = await page.evaluate(() =>
    window.localStorage.getItem('ghc.admin.sidebar.collapsed'),
  );

  // Click `access` header to collapse it.
  await page.click('[data-group="access"] button');
  await page.waitForTimeout(200);

  const afterToggle = await page.evaluate(() =>
    window.localStorage.getItem('ghc.admin.sidebar.collapsed'),
  );

  let parsed = null;
  let parseOk = false;
  try {
    parsed = JSON.parse(afterToggle ?? 'null');
    parseOk = parsed !== null && typeof parsed === 'object' && parsed.access === true;
  } catch {}

  results.check5_localStorage = {
    beforeToggle,
    afterToggle,
    parsedAccess: parsed?.access ?? null,
    parseOk,
    // "before" may be null OR "{}" (initial state write). The load-bearing
    // assertion is that AFTER the toggle, the key parses to JSON with
    // `access === true`.
    pass: parseOk,
  };
  console.log(`[check5] localStorage: ${results.check5_localStorage.pass ? 'PASS' : 'FAIL'} (before=${beforeToggle}, after.parsed.access=${parsed?.access})`);

  // ===== Check 6: command palette — Ctrl+K opens with 18 sections flat =====
  // Reset state and reload /admin to ensure palette API is fresh.
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await ensureSidebar(page);
  await page.waitForTimeout(1500); // allow CommandPalette useEffect to attach listener

  // Confirm the dialog is mounted (component rendered) before dispatch.
  const paletteMounted = await page.$('dialog.ghc-admin-palette-dialog');
  console.log(`[check6] palette dialog mounted: ${paletteMounted !== null}`);

  // Open palette via Ctrl+K. The palette is a native <dialog> opened via
  // dialog.showModal(); the CSS class is `ghc-admin-palette-dialog`.
  // We dispatch the keydown via window so the component's global
  // keydown listener (command-palette.tsx) catches it — Playwright's
  // `keyboard.press('Control+K')` does NOT reliably bubble to the
  // window listener when the focused element is the page body, because
  // Chromium treats synthetic key events at the window level differently
  // than JS-dispatched KeyboardEvent objects.
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }),
    );
  });
  // Wait for the dialog to appear (the lazy fetch + render takes a moment).
  let dialog = null;
  for (let i = 0; i < 50; i++) {
    dialog = await page.$('dialog.ghc-admin-palette-dialog[open]');
    if (dialog) break;
    await page.waitForTimeout(100);
  }

  // Wait for at least one palette section item to render (fetch resolved).
  // Count ALL `.ghc-admin-palette-item` elements across all groups.
  // The component renders sections, details, and audit in that order; the
  // palette's API exposes the same sections (`loadPaletteData` flattens
  // ADMIN_GROUPS into a single list of 18 for admin, 7 for operator).
  let sectionCount = 0;
  let sectionTitles = [];
  let paletteSectionHrefs = [];
  let allGroups = [];
  if (dialog) {
    for (let i = 0; i < 50; i++) {
      const items = await dialog.$$('.ghc-admin-palette-item');
      if (items.length > 0) {
        // Capture group structure (label + item count) for diagnostic.
        allGroups = await dialog.$$eval(
          '.ghc-admin-palette-group',
          (groups) => groups.map((g) => ({
            label: g.querySelector('.ghc-admin-palette-group-label')?.textContent ?? null,
            itemCount: g.querySelectorAll('.ghc-admin-palette-item').length,
          })),
        );
        // Items that are links to /admin/* sections (have a href like
        // /admin or /admin/something) are palette sections. Audit entries
        // are <span> (no href); details are <a> to /admin/users/<id>.
        // The criterion: href starts with /admin and does NOT match
        // /admin/users/<digit> (which is a user detail link).
        const sectionItems = await dialog.$$eval(
          '.ghc-admin-palette-item a.ghc-admin-palette-hit',
          (els) =>
            els
              .map((el) => ({
                href: el.getAttribute('href'),
                title: el.querySelector('.ghc-admin-palette-title')?.textContent ?? null,
              }))
              .filter((it) => it.href && !/\/admin\/users\/\d+/.test(it.href)),
        );
        sectionCount = sectionItems.length;
        sectionTitles = sectionItems.map((it) => it.title);
        paletteSectionHrefs = sectionItems.map((it) => it.href);
        break;
      }
      await page.waitForTimeout(100);
    }
  }

  results.check6_paletteFlat = {
    dialogFound: dialog !== null,
    sectionCount,
    sectionTitles,
    paletteSectionHrefs,
    allGroups,
    pass: dialog !== null && sectionCount === 18,
  };
  console.log(`[check6] palette: ${results.check6_paletteFlat.pass ? 'PASS' : 'FAIL'} (count=${sectionCount})`);

  // Take a screenshot of the palette open for evidence.
  if (dialog) {
    await page.screenshot({ path: path.join(OUT_DIR, 'palette-open.png'), fullPage: true });
  }

  // ===== Check 4: switch role to operator — operations and system disappear =====
  // Clear cookies and re-login as operator.
  await context.clearCookies();
  await login(page, OPERATOR_EMAIL, OPERATOR_PASS);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const operatorGroups = {};
  for (const slug of SLUGS) {
    const el = await page.$(`[data-group="${slug}"]`);
    operatorGroups[slug] = el !== null;
  }

  const visibleGroups = Object.entries(operatorGroups).filter(([, v]) => v).map(([k]) => k);
  const hiddenGroups = Object.entries(operatorGroups).filter(([, v]) => !v).map(([k]) => k);

  results.check4_operatorRole = {
    visible: visibleGroups,
    hidden: hiddenGroups,
    pass:
      operatorGroups.overview &&
      operatorGroups.access &&
      operatorGroups.data &&
      !operatorGroups.operations &&
      !operatorGroups.system,
  };
  console.log(`[check4] operator role: ${results.check4_operatorRole.pass ? 'PASS' : 'FAIL'} (visible=${visibleGroups.join(',')}, hidden=${hiddenGroups.join(',')})`);

  await page.screenshot({ path: path.join(OUT_DIR, 'operator-view.png'), fullPage: true });

  // ===== Aggregate =====
  const allPass = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, v.pass]),
  );
  const allOk = Object.values(allPass).every(Boolean);

  const report = {
    timestamp: new Date().toISOString(),
    base: BASE,
    results,
    allPass: allOk,
  };
  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  for (const [k, v] of Object.entries(allPass)) {
    console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
  }
  console.log(`\nALL PASS: ${allOk}`);
  console.log(`Report: ${path.join(OUT_DIR, 'report.json')}`);

  await browser.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] FATAL:', err);
  process.exit(2);
});