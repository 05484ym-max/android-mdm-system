// Real browser smoke test for the app-catalog management UI changes
// (branch app-catalog-management-ui): the always-visible add-app area
// (search Google Play / upload APK / add manually) now sits above the app
// list instead of below it, and each catalog tile has a clear "הסר
// מהמערכת" (remove from system) button that confirms before deleting.
// Real headless Chromium (Playwright), a real running backend/index.js, a
// real local PostgreSQL database - nothing mocked.
//
// ---------------------------------------------------------------------
// One-time setup: same appstore_test / appstore_test_user database as
// test-app-catalog-integration.js / test-app-delete-integration.js (see
// either file's header for the exact commands).
//
// From backend/:
//
//   (
//     export DATABASE_URL="postgresql://appstore_test_user:appstore_test_pw@127.0.0.1:5432/appstore_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4343 TEST_BASE_URL=http://127.0.0.1:4343
//     node index.js > /tmp/server-catalog-mgmt-ui.log 2>&1 &
//     SERVER_PID=$!
//     node test-app-catalog-management-ui-smoke.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4343';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright is not installed/usable in this environment:', e.message);
  console.error('APP CATALOG MANAGEMENT UI SMOKE NOT VERIFIED');
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

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
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
  const versionDir = path.join(base, dirs.sort().pop());
  // Playwright's own internal layout has changed across versions - older
  // installs unzip to chrome-linux/chrome, newer ones ("Chrome for
  // Testing") to chrome-linux64/chrome. Try both rather than hardcoding
  // either (see test-news-ui-smoke.js's identical fix for the real CI
  // failure this was discovered from).
  for (const dirName of ['chrome-linux', 'chrome-linux64']) {
    const candidate = path.join(versionDir, dirName, 'chrome');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`no chrome executable found under ${versionDir} (checked chrome-linux/ and chrome-linux64/)`);
}

// Polls for the actual expected count rather than a coarser signal that
// could already be true before the real re-render happens - same
// discipline as the other UI smoke suites in this project.
async function waitForCount(getCount, expected, timeoutMs = 8000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await getCount();
    if (last === expected) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for count ${expected} - last seen: ${last}`);
}

async function createTestDevice(label, allowedApps) {
  const deviceId = `catmgmt-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(
    `INSERT INTO devices (device_id, auth_token_hash, policy)
     VALUES ($1, $2, $3::jsonb)`,
    [deviceId, sha256(token), JSON.stringify({ allowedApps, kioskEnabled: false })],
  );
  return deviceId;
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();

  await db.addAppToCatalog('com.catmgmt.alpha', 'Alpha App', null, '1.0', Date.now(), 'tools');
  await db.addAppToCatalog('com.catmgmt.beta', 'Beta App', null, '1.0', Date.now(), 'tools');
  const device = await createTestDevice('main', ['com.catmgmt.beta']);

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

    await test('the add-app area (Play search / upload APK / manual add) appears before the catalog list in the DOM', async () => {
      const order = await page.evaluate(() => {
        const addRow = document.getElementById('appImportActions');
        const manualRow = document.getElementById('addAppToCatalogRow');
        const list = document.getElementById('catalogList');
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        return {
          importBeforeList: Boolean(addRow.compareDocumentPosition(list) & FOLLOWING),
          manualBeforeList: Boolean(manualRow.compareDocumentPosition(list) & FOLLOWING),
        };
      });
      assert.strictEqual(order.importBeforeList, true, 'Play-search/upload-APK row must precede the app list');
      assert.strictEqual(order.manualBeforeList, true, 'manual-add row must precede the app list');
    });

    await test('the add-app buttons are visible without scrolling past the catalog list', async () => {
      const playSearchBtn = page.locator('#openPlaySearchBtn');
      await expectVisible(playSearchBtn);
      const uploadApkBtn = page.locator('#openApkUploadBtn');
      await expectVisible(uploadApkBtn);
      // Their vertical position must be above the first rendered tile.
      const addBox = await playSearchBtn.boundingBox();
      const tileBox = await page.locator('#catalogList .catalog-tile').first().boundingBox();
      assert.ok(addBox && tileBox, 'both elements must be rendered with a real bounding box');
      assert.ok(addBox.y < tileBox.y, 'the add-app row must render above the first catalog tile');
    });

    await test('every catalog tile shows a clear "הסר מהמערכת" button', async () => {
      const count = await page.locator('[data-remove-app]').count();
      assert.strictEqual(count, 2);
      const label = await page.locator('[data-remove-app]').first().textContent();
      assert.strictEqual(label.trim(), 'הסר מהמערכת');
    });

    await test('canceling the confirmation leaves the app in the catalog untouched', async () => {
      let dialogMessage = null;
      const onDialog = dialog => {
        dialogMessage = dialog.message();
        dialog.dismiss();
      };
      page.once('dialog', onDialog);

      await page.locator('[data-remove-app="com.catmgmt.alpha"]').click();
      await page.waitForTimeout(300);

      assert.ok(dialogMessage && dialogMessage.includes('Alpha App'), 'confirmation must name the app being removed');
      const stillThere = await (await fetch(`${BASE_URL}/api/apps`, {
        headers: { Cookie: await getCookie(page) },
      })).json();
      assert.ok(stillThere.some(a => a.packageName === 'com.catmgmt.alpha'), 'app must still exist after canceling');
      assert.strictEqual(await page.locator('[data-remove-app="com.catmgmt.alpha"]').count(), 1);
    });

    await test('confirming removal deletes the app from the catalog, from the device that had it allowed, and shows a success message', async () => {
      // Two dialogs fire in sequence for this flow: the confirm() prompt,
      // then (once the DELETE request succeeds) the success alert() - a
      // persistent listener that accepts and records every one covers both.
      const dialogMessages = [];
      page.on('dialog', dialog => {
        dialogMessages.push(dialog.message());
        dialog.accept();
      });

      await page.locator('[data-remove-app="com.catmgmt.beta"]').click(); // triggers confirm -> accepted
      // A second dialog (the success alert) follows once the request completes.
      await waitForCount(() => page.locator('[data-remove-app="com.catmgmt.beta"]').count(), 0, 10000);

      assert.ok(
        dialogMessages.some(m => m.includes('הוסרה מהמערכת') || m.includes('Beta App')),
        `expected a success message among: ${JSON.stringify(dialogMessages)}`,
      );

      const catalog = await (await fetch(`${BASE_URL}/api/apps`, { headers: { Cookie: await getCookie(page) } })).json();
      assert.ok(!catalog.some(a => a.packageName === 'com.catmgmt.beta'), 'app must be gone from the catalog');

      const devices = await (await fetch(`${BASE_URL}/api/devices`, { headers: { Cookie: await getCookie(page) } })).json();
      const updatedDevice = devices.find(d => d.deviceId === device);
      assert.ok(updatedDevice, 'device must still exist');
      assert.deepStrictEqual(updatedDevice.policy.allowedApps, [], 'the deleted app must be stripped from the device that had it allowed');

      page.removeAllListeners('dialog');
    });

    await test('no uncaught page errors occurred during the whole flow', () => {
      assert.deepStrictEqual(pageErrors, []);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
    }
  } finally {
    await browser.close();
    await rawPool.end();
  }
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL (suite could not complete):', e);
  process.exit(1);
});

async function expectVisible(locator) {
  const visible = await locator.isVisible();
  assert.strictEqual(visible, true);
}

// Reuses the browser's own session cookie for a plain fetch() verification
// call (outside the page) - Playwright's browser context cookie jar.
async function getCookie(page) {
  const cookies = await page.context().cookies();
  const session = cookies.find(c => c.name === 'session');
  return session ? `session=${session.value}` : '';
}
