'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeGitHubServer } = require('./fakeGitHubServer');
const { buildTestApk } = require('./testApkFixture');

const PORT = 4354;
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('playwright unavailable:', e.message);
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
    console.log(`  ${e.stack || e.message}`);
  }
}

async function waitForServer(proc, timeoutMs = 20000) {
  const start = Date.now();
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`backend exited: ${stderr}`);
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`backend did not become healthy: ${stderr}`);
}

function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const candidates = fs.readdirSync(base)
    .filter(name => /^chromium(?:_headless_shell)?-\d+$/.test(name))
    .sort()
    .reverse();

  for (const dir of candidates) {
    for (const rel of [
      'chrome-linux/chrome',
      'chrome-linux64/chrome',
      'chrome-headless-shell-linux64/chrome-headless-shell',
    ]) {
      const candidate = path.join(base, dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`no Chromium executable found under ${base}`);
}

async function waitForText(locator, predicate, timeoutMs = 15000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = (await locator.textContent() || '').trim();
    if (predicate(last)) return last;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for status; last="${last}"`);
}

(async () => {
  const github = await startFakeGitHubServer();
  const serverProc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_SSL: 'disable',
      SECURE_COOKIES: '0',
      NODE_ENV: 'test',
      GITHUB_APK_TOKEN: 'test-token',
      GITHUB_APK_REPOSITORY: 'test-owner/test-repo',
      GITHUB_APK_RELEASE_TAG: 'app-store-assets',
      APK_STORAGE_TEST_BASE_URL: github.baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const fixturePath = path.join(os.tmpdir(), `apk-upload-ui-${crypto.randomUUID()}.apk`);
  let browser;

  try {
    await waitForServer(serverProc);
    await db.init();
    await rawPool.query(
      'TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE'
    );

    fs.writeFileSync(fixturePath, buildTestApk('org.yehudikasher.browser', 4096));

    browser = await chromium.launch({
      executablePath: resolveChromiumExecutable(),
      args: ['--disable-background-networking', '--disable-sync'],
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

    await test('APK upload button is enabled', async () => {
      assert.strictEqual(await page.locator('#openApkUploadBtn').isDisabled(), false);
    });

    await test('upload modal opens and package field is readonly/automatic', async () => {
      await page.click('#openApkUploadBtn');
      await page.waitForSelector('#apkUploadModal', { state: 'visible' });
      assert.strictEqual(await page.inputValue('#apkPackageName'), '');
      assert.strictEqual(await page.locator('#apkPackageName').isEditable(), false);
      const placeholder = await page.locator('#apkPackageName').getAttribute('placeholder');
      assert.ok(placeholder.includes('אוטומטית'));
    });

    await test('selecting APK requires no manual package input', async () => {
      await page.setInputFiles('#apkFileInput', fixturePath);
      await page.fill('#apkAppName', 'דפדפן כשר');
      assert.strictEqual(await page.inputValue('#apkPackageName'), '');
    });

    await test('real UI upload succeeds and shows auto-detected package name', async () => {
      await page.click('#apkUploadSubmitBtn');
      const status = await waitForText(
        page.locator('#apkUploadStatus'),
        text => text.includes('הועלה בהצלחה') && text.includes('org.yehudikasher.browser'),
      );
      assert.ok(status.includes('דפדפן כשר'));
      assert.strictEqual(await page.inputValue('#apkPackageName'), 'org.yehudikasher.browser');

      const row = (await db.listAppsCatalog()).find(x => x.packageName === 'org.yehudikasher.browser');
      assert.ok(row);
      assert.strictEqual(row.appSource, 'APK');
      assert.ok(github.assets.size >= 1);
    });

    await test('catalog refresh shows exactly one APK source badge', async () => {
      await page.waitForSelector('#catalogList .apk-source-badge', { timeout: 10000 });
      assert.strictEqual(await page.locator('#catalogList .apk-source-badge').count(), 1);
    });

    await test('stale first-party APK icon URL retries through current origin before letter fallback', async () => {
      const row = (await db.listAppsCatalog()).find(x => x.packageName === 'org.yehudikasher.browser');
      assert.ok(row && row.apkIconStorageKey, 'test APK must have an extracted icon asset');

      await rawPool.query(
        'UPDATE apps_catalog SET icon_url = $2 WHERE package_name = $1',
        [
          'org.yehudikasher.browser',
          `http://legacy.invalid/api/apps/icon/${row.apkIconStorageKey}`,
        ],
      );

      await page.evaluate(() => loadAppsCatalog());
      const icon = page.locator('#catalogList img.catalog-icon');
      await icon.waitFor({ state: 'attached', timeout: 10000 });
      await page.waitForFunction(
        expectedPrefix => {
          const img = document.querySelector('#catalogList img.catalog-icon');
          return Boolean(img && img.src.startsWith(expectedPrefix));
        },
        `${BASE_URL}/api/apps/icon/`,
      );

      assert.strictEqual(await page.locator('#catalogList .catalog-icon-placeholder').count(), 0);
      assert.ok((await icon.getAttribute('src')).startsWith(`${BASE_URL}/api/apps/icon/`));
    });

    await test('no uncaught page errors occurred', async () => {
      assert.deepStrictEqual(pageErrors, []);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      for (const failure of failures) {
        console.log(`- ${failure.name}: ${failure.error.message}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(fixturePath); } catch {}
    if (serverProc.exitCode === null) {
      serverProc.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        serverProc.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    await github.close();
    await rawPool.end();
  }

  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e);
  try { await rawPool.end(); } catch {}
  process.exit(1);
});
