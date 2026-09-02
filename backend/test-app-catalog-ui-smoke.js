// Real browser smoke test for the App Store categories admin UI (branch
// app-store-categories). Real headless Chromium (pre-installed under
// PLAYWRIGHT_BROWSERS_PATH in this sandbox, same setup as the
// filtered-browser-server branch's test-admin-ui-e2e.js), a real running
// backend/index.js, a real local PostgreSQL database. Scoped to the
// catalog area only - not a full admin-panel regression sweep.
//
// ---------------------------------------------------------------------
// One-time setup: same appstore_test / appstore_test_user database as
// test-app-catalog-integration.js (see that file's header for the exact
// commands).
//
// From backend/:
//
//   (
//     export DATABASE_URL="postgresql://appstore_test_user:appstore_test_pw@127.0.0.1:5432/appstore_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4342 TEST_BASE_URL=http://127.0.0.1:4342
//     node index.js > /tmp/server-appstore-ui.log 2>&1 &
//     SERVER_PID=$!
//     node test-app-catalog-ui-smoke.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4342';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright is not installed/usable in this environment:', e.message);
  console.error('ADMIN UI SMOKE NOT VERIFIED');
  process.exit(1);
}

const db = require('./db');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
rawPool.on('error', err => console.error('idle test pool error:', err.message));

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL - ${name}`);
    console.log(`  ${e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e.message}`);
  }
}

// renderCatalog() fully replaces #catalogList's innerHTML on every
// loadAppsCatalog() call, so a selector that already matched BEFORE an
// action (e.g. "#catalogList .catalog-tile" - the grid already has tiles
// from the initial render) resolves immediately and proves nothing about
// whether the *specific* re-render triggered by that action has finished.
// This polls for the actual expected text instead of any coarser "did
// something render" signal.
async function waitForText(getText, expected, timeoutMs = 8000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = (await getText()).trim();
    if (last === expected) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for text "${expected}" - last seen: "${last}"`);
}

async function waitForServer(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server at ${BASE_URL} did not become ready within ${timeoutMs}ms`);
}

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`);
}

function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(require('os').homedir(), '.cache', 'ms-playwright');
  const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d));
  if (!dirs.length) throw new Error(`no chromium-* directory found under ${base}`);
  return path.join(base, dirs.sort().pop(), 'chrome-linux', 'chrome');
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();

  await db.addAppToCatalog('com.smoke.playapp', 'Smoke Play App', null, '1.0', Date.now(), 'communication');
  await db.addAppToCatalog('com.smoke.legacy', 'Smoke Legacy App', null);

  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    executablePath,
    args: ['--disable-background-networking', '--disable-sync', '--disable-client-side-phishing-detection'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err)));

  try {
    await page.goto(BASE_URL);
    await page.fill('#loginUsername', process.env.ADMIN_USERNAME);
    await page.fill('#loginPassword', process.env.ADMIN_PASSWORD);
    await page.click('#loginBtn');
    await page.waitForSelector('.login-screen', { state: 'hidden', timeout: 10000 }).catch(() => {});

    await page.click('[data-tab="catalog"]');
    await page.waitForSelector('#catalogList .catalog-tile', { timeout: 10000 });

    await test('org preview shows real counts (all apps / recommended / play data)', async () => {
      const allValue = await page.locator('#appstorePreview .stat-card').nth(2).locator('.value').textContent();
      assert.strictEqual(allValue.trim(), '2');
    });

    await test('category chips render, including "הכל"', async () => {
      const chipTexts = await page.locator('#catalogCategoryChips .category-chip').allTextContents();
      assert.ok(chipTexts.includes('הכל'));
      assert.ok(chipTexts.includes('תקשורת'));
    });

    await test('each catalog tile shows a category select, a recommended toggle, and a sort-order input', async () => {
      const selects = await page.locator('[data-category-select]').count();
      const toggles = await page.locator('[data-recommended-toggle]').count();
      const sortInputs = await page.locator('[data-sort-order]').count();
      assert.strictEqual(selects, 2);
      assert.strictEqual(toggles, 2);
      assert.strictEqual(sortInputs, 2);
    });

    await test('search matches by category label ("תקשורת" narrows to the Play app only)', async () => {
      await page.fill('#catalogSearch', 'תקשורת');
      await page.waitForTimeout(150);
      const names = await page.locator('#catalogList .catalog-name').allTextContents();
      assert.deepStrictEqual(names, ['Smoke Play App']);
      await page.fill('#catalogSearch', '');
    });

    await test('search matches by package name', async () => {
      await page.fill('#catalogSearch', 'com.smoke.legacy');
      await page.waitForTimeout(150);
      const names = await page.locator('#catalogList .catalog-name').allTextContents();
      assert.deepStrictEqual(names, ['Smoke Legacy App']);
      await page.fill('#catalogSearch', '');
    });

    await test('category filter chip narrows the grid to that category only', async () => {
      await page.click('[data-category-chip="communication"]');
      await page.waitForTimeout(150);
      const names = await page.locator('#catalogList .catalog-name').allTextContents();
      assert.deepStrictEqual(names, ['Smoke Play App']);
      await page.click('[data-category-chip="all"]');
      await page.waitForTimeout(150);
    });

    await test('changing the category dropdown persists a MANUAL category via a real request', async () => {
      await page.selectOption('[data-category-select="com.smoke.legacy"]', 'tools');
      const badgeLocator = page.locator('[data-category-select="com.smoke.legacy"]').locator('xpath=following-sibling::span[1]');
      await waitForText(() => badgeLocator.textContent(), 'ידני');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.smoke.legacy');
      assert.strictEqual(row.category, 'tools');
      assert.strictEqual(row.categorySource, 'MANUAL');
    });

    await test('clicking the recommended toggle persists isRecommended=true via a real request', async () => {
      await page.click('[data-recommended-toggle="com.smoke.playapp"]');
      const toggleLocator = page.locator('[data-recommended-toggle="com.smoke.playapp"]');
      await waitForText(() => toggleLocator.textContent(), '★ מומלצת');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.smoke.playapp');
      assert.strictEqual(row.isRecommended, true);
    });

    await test('changing the sort-order input persists sortOrder via a real request', async () => {
      const input = page.locator('[data-sort-order="com.smoke.legacy"]');
      await input.fill('42');
      await input.dispatchEvent('change');
      await waitForText(async () => String(await input.inputValue()), '42');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.smoke.legacy');
      assert.strictEqual(row.sortOrder, 42);
    });

    await test('sort-order actually reorders the rendered catalog grid', async () => {
      // Alphabetically "Smoke Legacy App" sorts before "Smoke Play App" -
      // giving the Play app a lower sortOrder must visibly reverse that,
      // proving the control drives real, observable ordering, not just a
      // stored number nobody reads.
      await page.locator('[data-sort-order="com.smoke.playapp"]').fill('1');
      await page.locator('[data-sort-order="com.smoke.playapp"]').dispatchEvent('change');
      await page.waitForSelector('#catalogList .catalog-tile', { timeout: 10000 });
      const namesLocator = page.locator('#catalogList .catalog-name');
      await waitForText(async () => (await namesLocator.allTextContents())[0], 'Smoke Play App');
      const names = await namesLocator.allTextContents();
      assert.deepStrictEqual(names, ['Smoke Play App', 'Smoke Legacy App']);
    });

    await test('an out-of-range sort-order value is rejected client-side and never reaches the server as a bad write', async () => {
      const before = (await db.listAppsCatalog()).find(a => a.packageName === 'com.smoke.legacy').sortOrder;
      // .catch(() => {}): if the CDP round-trip for dismissing this dialog
      // is still in flight when the suite's final browser.close() runs, the
      // accept() promise rejects with a "session closed" protocol error -
      // an unhandled rejection that would otherwise crash the whole process
      // well after this test's own assertions already passed.
      page.once('dialog', d => { d.accept().catch(() => {}); });
      const input = page.locator('[data-sort-order="com.smoke.legacy"]');
      await input.fill('999999');
      await input.dispatchEvent('change');
      await page.waitForSelector('#catalogList .catalog-tile', { timeout: 10000 });
      const after = (await db.listAppsCatalog()).find(a => a.packageName === 'com.smoke.legacy').sortOrder;
      assert.strictEqual(after, before, 'an out-of-range value must never be written');
    });

    await test('org preview "מומלצות" count updates to reflect the toggle above', async () => {
      const recommendedLocator = page.locator('#appstorePreview .stat-card').nth(1).locator('.value');
      await waitForText(() => recommendedLocator.textContent(), '1');
    });

    await test('no uncaught JavaScript exception occurred anywhere in the session', async () => {
      assert.deepStrictEqual(pageErrors, []);
    });
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
  }
  await rawPool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL (suite could not complete):', e);
  try { await rawPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
