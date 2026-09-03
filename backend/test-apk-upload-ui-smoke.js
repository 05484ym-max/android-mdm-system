// Real browser smoke test for the APK upload admin UI (openApkUploadBtn /
// apk-upload.js). Real headless Chromium (pre-installed under
// PLAYWRIGHT_BROWSERS_PATH in this sandbox, same setup as the other UI
// smoke suites), a real running backend/index.js, a real local PostgreSQL
// database, and a real local fake-S3 HTTP server standing in for R2 (see
// fakeS3Server.js - this sandbox has no real R2 credentials/network
// reachability). Scoped to the upload modal only, not a full admin-panel
// regression sweep.
//
// ---------------------------------------------------------------------
// One-time setup: same apkupload_test / apkupload_test_user database as
// test-apk-upload-integration.js (see that file's header for the exact
// commands).
//
// From backend/, this file starts its own fake-S3 server and its own
// backend/index.js child process (it needs to inject APK_STORAGE_ENDPOINT
// pointing at that fake server, which an externally-launched fixture
// server couldn't know in advance):
//
//   (
//     export DATABASE_URL="postgresql://apkupload_test_user:apkupload_test_pw@127.0.0.1:5432/apkupload_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     node test-apk-upload-ui-smoke.js
//     exit $?
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeS3Server } = require('./fakeS3Server');
const { buildTestApk } = require('./testApkFixture');

const PORT = 4354;
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright is not installed/usable in this environment:', e.message);
  console.error('APK UPLOAD ADMIN UI SMOKE NOT VERIFIED');
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
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d));
  if (!dirs.length) throw new Error(`no chromium-* directory found under ${base}`);
  return path.join(base, dirs.sort().pop(), 'chrome-linux', 'chrome');
}

// Same "waits for the actual re-render's real signal, not a coarser one
// that already matched pre-action" discipline used by the other UI smoke
// suites in this project (see test-app-catalog-ui-smoke.js's waitForText).
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

(async () => {
  const s3 = await startFakeS3Server();
  const serverProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_SSL: 'disable',
      SECURE_COOKIES: '0',
      APK_STORAGE_ENDPOINT: s3.baseUrl,
      APK_STORAGE_REGION: 'auto',
      APK_STORAGE_BUCKET: 'apk-ui-smoke-bucket',
      APK_STORAGE_ACCESS_KEY_ID: 'fake-access-key',
      APK_STORAGE_SECRET_ACCESS_KEY: 'fake-secret-key',
      APK_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/apks',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  const fixtureApkPath = path.join(os.tmpdir(), `apk-upload-ui-smoke-${crypto.randomUUID()}.apk`);
  let browser;
  try {
    await waitForServer();
    await db.init();
    await resetTestDatabase();

    const apkBuffer = buildTestApk('com.uismoke.apk', 4096);
    fs.writeFileSync(fixtureApkPath, apkBuffer);

    const executablePath = resolveChromiumExecutable();
    browser = await chromium.launch({
      executablePath,
      args: ['--disable-background-networking', '--disable-sync', '--disable-client-side-phishing-detection'],
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(String(err)));

    await page.goto(BASE_URL);
    await page.fill('#loginUsername', process.env.ADMIN_USERNAME);
    await page.fill('#loginPassword', process.env.ADMIN_PASSWORD);
    await page.click('#loginBtn');
    await page.waitForSelector('.login-screen', { state: 'hidden', timeout: 10000 }).catch(() => {});

    await page.click('[data-tab="catalog"]');
    await page.waitForSelector('#catalogList', { timeout: 10000 });

    await test('the APK upload button is enabled (no longer the disabled placeholder)', async () => {
      const disabled = await page.locator('#openApkUploadBtn').isDisabled();
      assert.strictEqual(disabled, false);
    });

    await test('clicking it opens the upload modal with an empty form', async () => {
      await page.click('#openApkUploadBtn');
      await page.waitForSelector('#apkUploadModal', { state: 'visible', timeout: 5000 });
      assert.strictEqual(await page.inputValue('#apkAppName'), '');
      assert.strictEqual(await page.inputValue('#apkPackageName'), '');
      const categoryOptionCount = await page.locator('#apkCategorySelect option').count();
      assert.ok(categoryOptionCount > 0, 'category options should be populated');
    });

    await test('submitting with an invalid package name shows a Hebrew validation error and uploads nothing', async () => {
      await page.setInputFiles('#apkFileInput', fixtureApkPath);
      await page.fill('#apkAppName', 'בדיקת UI');
      await page.fill('#apkPackageName', 'not-a-valid-package-name');
      await page.click('#apkUploadSubmitBtn');
      await waitForText(() => page.locator('#apkUploadStatus').textContent(), 'שם חבילה לא תקין (לדוגמה: com.example.app)');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'not-a-valid-package-name');
      assert.strictEqual(row, undefined);
    });

    await test('a real upload through the UI succeeds, shows a Hebrew success message, and refreshes the catalog with an APK badge', async () => {
      await page.click('#apkUploadSubmitBtn');
      await waitForText(
        () => page.locator('#apkUploadStatus').textContent(),
        'הועלה בהצלחה: בדיקת UI',
        15000,
      );
      await page.waitForSelector('#apkUploadModal', { state: 'hidden', timeout: 5000 });

      const row = await db.listAppsCatalog();
      const uploaded = row.find(a => a.packageName === 'com.uismoke.apk');
      assert.ok(uploaded, 'catalog row must exist after the UI upload');
      assert.strictEqual(uploaded.appSource, 'APK');

      await page.waitForSelector('#catalogList .catalog-tile .apk-source-badge', { timeout: 10000 });
      const badgeCount = await page.locator('#catalogList .apk-source-badge').count();
      assert.strictEqual(badgeCount, 1, 'exactly one tile should show the APK badge');
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
    if (browser) await browser.close();
    try { fs.unlinkSync(fixtureApkPath); } catch { /* best-effort cleanup */ }
    serverProc.kill('SIGTERM');
    await new Promise(r => serverProc.once('exit', r));
    await s3.close();
    await rawPool.end();
  }
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL (suite could not complete):', e);
  process.exit(1);
});
