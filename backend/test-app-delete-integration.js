// REAL PostgreSQL + real HTTP integration suite for global app-catalog
// deletion (DELETE /api/apps/:packageName) and a regression check of the
// pre-existing per-device removal (DELETE /api/devices/:deviceId/policy/
// apps/:packageName, "הסר מהלקוח" in the admin panel). Real Postgres, a
// real running backend/index.js, and - for the APK asset-cleanup
// scenarios - a real local HTTP server standing in for the GitHub
// Releases API (fakeGitHubServer.js, the same test double
// test-apk-upload-integration.js already uses), redirected to via
// apkStorage.js's NODE_ENV=test-only APK_STORAGE_TEST_BASE_URL override.
// Nothing here is mocked at the application layer.
//
// ---------------------------------------------------------------------
// One-time local setup - same appstore_test / appstore_test_user database
// already used by test-app-catalog-integration.js:
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS appstore_test;" \
//     -c "DROP ROLE IF EXISTS appstore_test_user;" \
//     -c "CREATE ROLE appstore_test_user LOGIN PASSWORD 'appstore_test_pw';" \
//     -c "CREATE DATABASE appstore_test OWNER appstore_test_user;"
//
// From backend/, in one shell (this file spawns/kills its own server
// processes, same pattern as test-apk-upload-integration.js, because the
// "Play app deletes cleanly with no GitHub token configured at all"
// scenario needs a process configured differently from the main one):
//
//   (
//     export DATABASE_URL="postgresql://appstore_test_user:appstore_test_pw@127.0.0.1:5432/appstore_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     node test-app-delete-integration.js
//     exit $?
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeGitHubServer } = require('./fakeGitHubServer');
const { buildTestApk } = require('./testApkFixture');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
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

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function spawnServer(port, extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_SSL: 'disable',
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      JWT_SECRET: process.env.JWT_SECRET,
      SECURE_COOKIES: '0',
      NODE_ENV: 'test',
      GITHUB_APK_REPOSITORY: 'test-owner/test-repo',
      GITHUB_APK_RELEASE_TAG: 'app-store-assets',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.testStderr = '';
  proc.stderr.on('data', d => { proc.testStderr += d.toString(); });
  return proc;
}

async function waitForHealth(baseUrl, proc, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`server exited early: ${proc.testStderr}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy: ${proc.testStderr}`);
}

async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 5000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function login(baseUrl) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

function uploadForm({ buffer, packageName, name, category, filename = 'app.apk' } = {}) {
  const form = new FormData();
  form.append(
    'apk',
    new Blob([buffer || buildTestApk(packageName || 'com.example.auto', 4096)], {
      type: 'application/vnd.android.package-archive',
    }),
    filename,
  );
  if (packageName !== undefined) form.append('packageName', packageName);
  if (name !== undefined) form.append('name', name);
  if (category !== undefined) form.append('category', category);
  return form;
}

async function uploadApk(baseUrl, cookie, opts) {
  return fetch(`${baseUrl}/api/apps/upload-apk`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: uploadForm(opts),
  });
}

async function adminFetch(baseUrl, cookie, urlPath, opts = {}) {
  return fetch(`${baseUrl}${urlPath}`, {
    ...opts,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Device auth itself is never exercised in this suite (every check here
// goes through admin routes) - the token hash just needs to be some
// syntactically valid value.
async function createTestDevice(label) {
  const deviceId = `del-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(
    `INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`,
    [deviceId, sha256(token)],
  );
  return deviceId;
}

async function assignApp(baseUrl, cookie, deviceId, packageName) {
  const res = await adminFetch(baseUrl, cookie, `/api/devices/${encodeURIComponent(deviceId)}/policy/apps`, {
    method: 'POST',
    body: JSON.stringify({ packageName }),
  });
  assert.strictEqual(res.status, 200, `assigning ${packageName} to ${deviceId} should succeed`);
}

async function allowedAppsFor(baseUrl, cookie, deviceId) {
  const res = await adminFetch(baseUrl, cookie, '/api/devices');
  const list = await res.json();
  const device = list.find(d => d.deviceId === deviceId);
  assert.ok(device, `device ${deviceId} should exist`);
  return device.policy.allowedApps;
}

async function resetTestDatabase() {
  await rawPool.query(
    `TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`,
  );
}

(async () => {
  const github = await startFakeGitHubServer();

  const mainPort = 4361;
  const noTokenPort = 4362;
  const mainBase = `http://127.0.0.1:${mainPort}`;
  const noTokenBase = `http://127.0.0.1:${noTokenPort}`;

  const main = spawnServer(mainPort, {
    GITHUB_APK_TOKEN: 'test-token',
    APK_STORAGE_TEST_BASE_URL: github.baseUrl,
  });
  let noToken = null;

  try {
    await waitForHealth(mainBase, main);
    await db.init();

    // A completely separate server instance with NO GitHub token configured
    // at all - proves deleting a Play-sourced app never even attempts to
    // reach APK storage (see index.js's `if (deleted.appSource === 'APK')`
    // guard around apkStorage.loadStorageConfig()).
    noToken = spawnServer(noTokenPort, { GITHUB_APK_TOKEN: '' });
    await waitForHealth(noTokenBase, noToken);

    await resetTestDatabase();
    const cookie = await login(mainBase);
    const noTokenCookie = await login(noTokenBase);

    // ================= validation / auth =================

    await test('DELETE /api/apps/:packageName rejects an invalid packageName format (400)', async () => {
      const res = await adminFetch(mainBase, cookie, '/api/apps/not-a-valid-package', { method: 'DELETE' });
      assert.strictEqual(res.status, 400);
    });

    await test('DELETE /api/apps/:packageName requires admin auth (401 without a session)', async () => {
      const res = await fetch(`${mainBase}/api/apps/com.example.whatever`, { method: 'DELETE' });
      assert.strictEqual(res.status, 401);
    });

    await test('DELETE /api/apps/:packageName for an app that does not exist returns 404', async () => {
      const res = await adminFetch(mainBase, cookie, '/api/apps/com.example.doesnotexist', { method: 'DELETE' });
      assert.strictEqual(res.status, 404);
    });

    // ================= global delete removes from catalog =================

    await test('global delete removes a Play-sourced app from the catalog', async () => {
      await db.addAppToCatalog('com.delete.playapp1', 'Play App 1', null, '1.0', Date.now(), 'other');
      const res = await adminFetch(mainBase, cookie, '/api/apps/com.delete.playapp1', { method: 'DELETE' });
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.packageName, 'com.delete.playapp1');

      const catalog = await (await adminFetch(mainBase, cookie, '/api/apps')).json();
      assert.ok(!catalog.some(a => a.packageName === 'com.delete.playapp1'));
    });

    // ================= global delete strips allowedApps + wakes devices =================

    await test('global delete removes the package from every device that had it allowed, and reports the count', async () => {
      await db.addAppToCatalog('com.delete.shared', 'Shared App', null, '1.0', Date.now(), 'other');
      const deviceA = await createTestDevice('a');
      const deviceB = await createTestDevice('b');
      const deviceC = await createTestDevice('c'); // never gets the app

      await assignApp(mainBase, cookie, deviceA, 'com.delete.shared');
      await assignApp(mainBase, cookie, deviceB, 'com.delete.shared');

      const res = await adminFetch(mainBase, cookie, '/api/apps/com.delete.shared', { method: 'DELETE' });
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.devicesUpdated, 2, 'only the two devices that actually had it allowed should be counted');

      assert.deepStrictEqual(await allowedAppsFor(mainBase, cookie, deviceA), []);
      assert.deepStrictEqual(await allowedAppsFor(mainBase, cookie, deviceB), []);
      assert.deepStrictEqual(await allowedAppsFor(mainBase, cookie, deviceC), []);
    });

    // ================= does not touch other apps or other devices' unrelated apps =================

    await test('global delete never touches a different app\'s catalog row or its own device assignments', async () => {
      await db.addAppToCatalog('com.delete.target', 'Target', null, '1.0', Date.now(), 'other');
      await db.addAppToCatalog('com.delete.bystander', 'Bystander', null, '1.0', Date.now(), 'other');
      const device = await createTestDevice('bystander');
      await assignApp(mainBase, cookie, device, 'com.delete.target');
      await assignApp(mainBase, cookie, device, 'com.delete.bystander');

      const res = await adminFetch(mainBase, cookie, '/api/apps/com.delete.target', { method: 'DELETE' });
      assert.strictEqual(res.status, 200);

      const catalog = await (await adminFetch(mainBase, cookie, '/api/apps')).json();
      assert.ok(!catalog.some(a => a.packageName === 'com.delete.target'), 'target must be gone');
      assert.ok(catalog.some(a => a.packageName === 'com.delete.bystander'), 'bystander catalog row must survive untouched');

      const allowed = await allowedAppsFor(mainBase, cookie, device);
      assert.deepStrictEqual(allowed, ['com.delete.bystander'], 'only the deleted package should be stripped, the bystander stays allowed');
    });

    // ================= APK/icon asset cleanup, scoped to only the deleted app =================

    await test('global delete of an APK-sourced app removes exactly its own APK and icon GitHub assets', async () => {
      const iconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const apkToDelete = buildTestApk('com.delete.apk1', 4096, { buffer: iconBytes });
      const apkToKeep = buildTestApk('com.delete.apk2', 4096, { buffer: iconBytes });

      const uploadedDelete = await (await uploadApk(mainBase, cookie, { buffer: apkToDelete, name: 'To Delete' })).json();
      const uploadedKeep = await (await uploadApk(mainBase, cookie, { buffer: apkToKeep, name: 'To Keep' })).json();

      const deleteApkAssetId = uploadedDelete.apkUrl.split('/').pop();
      const deleteIconAssetId = uploadedDelete.iconUrl.split('/').pop();
      const keepApkAssetId = uploadedKeep.apkUrl.split('/').pop();
      const keepIconAssetId = uploadedKeep.iconUrl.split('/').pop();

      assert.ok(github.assets.has(deleteApkAssetId));
      assert.ok(github.assets.has(deleteIconAssetId));
      assert.ok(github.assets.has(keepApkAssetId));
      assert.ok(github.assets.has(keepIconAssetId));

      const res = await adminFetch(mainBase, cookie, '/api/apps/com.delete.apk1', { method: 'DELETE' });
      assert.strictEqual(res.status, 200);

      assert.strictEqual(github.assets.has(deleteApkAssetId), false, 'the deleted app\'s APK asset must be removed from GitHub');
      assert.strictEqual(github.assets.has(deleteIconAssetId), false, 'the deleted app\'s icon asset must be removed from GitHub');
      assert.strictEqual(github.assets.has(keepApkAssetId), true, 'a different APK app\'s asset must never be touched');
      assert.strictEqual(github.assets.has(keepIconAssetId), true, 'a different APK app\'s icon asset must never be touched');
    });

    await test('global delete of a Play-sourced app never touches GitHub storage (works with zero storage config)', async () => {
      await db.addAppToCatalog('com.delete.playnotoken', 'Play No Token', null, '1.0', Date.now(), 'other');
      const before = github.assets.size;
      const res = await adminFetch(noTokenBase, noTokenCookie, '/api/apps/com.delete.playnotoken', { method: 'DELETE' });
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(github.assets.size, before, 'no GitHub call should have been attempted for a Play app');
    });

    // ================= per-device removal keeps working, stays scoped =================

    await test('per-device removal ("הסר מהלקוח") still removes only from that one device, never the catalog or other devices', async () => {
      await db.addAppToCatalog('com.delete.perdevice', 'Per Device', null, '1.0', Date.now(), 'other');
      const deviceA = await createTestDevice('perdevice-a');
      const deviceB = await createTestDevice('perdevice-b');
      await assignApp(mainBase, cookie, deviceA, 'com.delete.perdevice');
      await assignApp(mainBase, cookie, deviceB, 'com.delete.perdevice');

      const res = await adminFetch(
        mainBase, cookie,
        `/api/devices/${encodeURIComponent(deviceA)}/policy/apps/${encodeURIComponent('com.delete.perdevice')}`,
        { method: 'DELETE' },
      );
      assert.strictEqual(res.status, 200);

      assert.deepStrictEqual(await allowedAppsFor(mainBase, cookie, deviceA), []);
      assert.deepStrictEqual(await allowedAppsFor(mainBase, cookie, deviceB), ['com.delete.perdevice'], 'device B must be unaffected');

      const catalog = await (await adminFetch(mainBase, cookie, '/api/apps')).json();
      assert.ok(catalog.some(a => a.packageName === 'com.delete.perdevice'), 'the catalog row must survive a per-device removal');
    });

    // ================= summary =================

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      for (const failure of failures) {
        console.log(`- ${failure.name}: ${failure.error.message}`);
      }
    }
  } finally {
    await Promise.all([stop(main), stop(noToken)]);
    await github.close();
    await rawPool.end();
  }

  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e);
  try { await rawPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
