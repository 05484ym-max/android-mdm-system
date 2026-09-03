// REAL PostgreSQL + real HTTP integration suite for persistent APK upload
// (POST /api/apps/upload-apk). Real local Postgres, real running
// backend/index.js processes, real multipart/form-data HTTP requests via
// the platform's own fetch()/FormData - nothing about the request/response
// path is mocked.
//
// Object storage itself: this sandbox has no real Cloudflare R2 (or any
// S3) credentials or network reachability, so a local HTTP server
// (fakeS3Server.js) stands in for the bucket - explicitly documented there
// as a real HTTP server the real @aws-sdk/client-s3 talks to, not a mock
// of the SDK. This proves apkStorage.js's own request/response handling,
// key generation and fail-closed behavior for real; it does not prove a
// specific R2 account/bucket is reachable (same honesty rule already
// applied to Google Play network access elsewhere in this project - see
// docs/apk-storage.md's "What could not be verified" section).
//
// ---------------------------------------------------------------------
// One-time local setup:
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS apkupload_test;" \
//     -c "DROP ROLE IF EXISTS apkupload_test_user;" \
//     -c "CREATE ROLE apkupload_test_user LOGIN PASSWORD 'apkupload_test_pw';" \
//     -c "CREATE DATABASE apkupload_test OWNER apkupload_test_user;"
//
// From backend/, in one shell:
//
//   (
//     export DATABASE_URL="postgresql://apkupload_test_user:apkupload_test_pw@127.0.0.1:5432/apkupload_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     node test-apk-upload-integration.js
//     exit $?
//   )
//
// This file spawns/kills its own server processes (a main fixture with a
// working fake-S3 endpoint, and a second one pointed at an unreachable
// storage endpoint) - the same pattern test-policy-signing-integration.js
// uses, for the same reason: the "storage failure" scenario needs a
// process configured differently from the main one.
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeS3Server } = require('./fakeS3Server');
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

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

/** A minimal buffer that satisfies looksLikeApk's content-based ZIP check
 * (a real APK's leading bytes) padded out with deterministic filler -
 * this is not a real installable APK (no central directory/manifest), only
 * a fixture whose FIRST FOUR BYTES are genuinely what looksLikeApk checks -
 * see index.js's own comment on why full APK parsing is out of scope. */
function fakeApkBuffer(sizeBytes = 4096, seed = 'apk-fixture', packageName = 'com.apk.fixture') {
  void seed;
  return buildTestApk(packageName, sizeBytes);
}

async function waitForHealth(baseUrl, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

function spawnServer(port, extraEnv = {}) {
  return spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_SSL: 'disable',
      ADMIN_USERNAME: process.env.ADMIN_USERNAME,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      JWT_SECRET: process.env.JWT_SECRET,
      SECURE_COOKIES: '0',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

function killAndWait(proc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!proc || proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('process did not exit in time')), timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
}

async function adminLogin(baseUrl) {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login succeeded but no Set-Cookie header was returned');
  return setCookie.split(';')[0];
}

function buildUploadForm({ apkBuffer, packageName, name, category, filename = 'app.apk' } = {}) {
  const form = new FormData();
  if (apkBuffer !== null) {
    form.append(
      'apk',
      new Blob([apkBuffer ?? fakeApkBuffer(4096, 'default', packageName || 'com.apk.autodetected')], {
        type: 'application/vnd.android.package-archive',
      }),
      filename,
    );
  }
  if (packageName !== undefined) form.append('packageName', packageName);
  if (name !== undefined) form.append('name', name);
  if (category !== undefined) form.append('category', category);
  return form;
}

async function uploadApk(baseUrl, cookie, opts) {
  return fetch(`${baseUrl}/api/apps/upload-apk`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: buildUploadForm(opts),
  });
}

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`);
}

(async () => {
  const workingS3 = await startFakeS3Server();
  const unreachableStorageEnv = {
    APK_STORAGE_ENDPOINT: 'http://127.0.0.1:1',
    APK_STORAGE_REGION: 'auto',
    APK_STORAGE_BUCKET: 'apk-test-bucket',
    APK_STORAGE_ACCESS_KEY_ID: 'fake-access-key',
    APK_STORAGE_SECRET_ACCESS_KEY: 'fake-secret-key',
    APK_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/apks',
  };
  const workingStorageEnv = {
    APK_STORAGE_ENDPOINT: workingS3.baseUrl,
    APK_STORAGE_REGION: 'auto',
    APK_STORAGE_BUCKET: 'apk-test-bucket',
    APK_STORAGE_ACCESS_KEY_ID: 'fake-access-key',
    APK_STORAGE_SECRET_ACCESS_KEY: 'fake-secret-key',
    APK_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/apks',
  };

  const mainPort = 4351;
  const mainBaseUrl = `http://127.0.0.1:${mainPort}`;
  const brokenStoragePort = 4352;
  const brokenStorageBaseUrl = `http://127.0.0.1:${brokenStoragePort}`;
  const noStorageConfigPort = 4353;
  const noStorageConfigBaseUrl = `http://127.0.0.1:${noStorageConfigPort}`;

  const mainServer = spawnServer(mainPort, workingStorageEnv);
  const brokenStorageServer = spawnServer(brokenStoragePort, unreachableStorageEnv);
  // No APK_STORAGE_* env vars at all - proves the whole feature fails
  // closed on a deployment that never configured object storage.
  const noStorageConfigServer = spawnServer(noStorageConfigPort, {
    APK_STORAGE_ENDPOINT: '', APK_STORAGE_BUCKET: '', APK_STORAGE_ACCESS_KEY_ID: '',
    APK_STORAGE_SECRET_ACCESS_KEY: '', APK_STORAGE_PUBLIC_BASE_URL: '',
  });

  try {
    await Promise.all([
      waitForHealth(mainBaseUrl),
      waitForHealth(brokenStorageBaseUrl),
      waitForHealth(noStorageConfigBaseUrl),
    ]);
    await db.init();
    await resetTestDatabase();

    const mainCookie = await adminLogin(mainBaseUrl);
    const brokenStorageCookie = await adminLogin(brokenStorageBaseUrl);
    const noStorageConfigCookie = await adminLogin(noStorageConfigBaseUrl);

    // ================= auth =================

    await test('unauthenticated upload is rejected before touching storage or the database', async () => {
      const before = workingS3.objects.size;
      const res = await uploadApk(mainBaseUrl, null, { packageName: 'com.apk.noauth', name: 'No Auth' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(workingS3.objects.size, before, 'nothing should have been uploaded');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.noauth');
      assert.strictEqual(row, undefined);
    });

    // ================= validation =================

    await test('a non-APK file (bad magic bytes) is rejected with 400 and no catalog row', async () => {
      const notApk = Buffer.from('this is definitely not a zip/apk file, just plain text padding'.repeat(10));
      const res = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: notApk, packageName: 'com.apk.notapk', name: 'Not An Apk',
      });
      assert.strictEqual(res.status, 400);
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.notapk');
      assert.strictEqual(row, undefined);
    });

    await test('missing packageName is auto-detected from the APK manifest', async () => {
      const res = await uploadApk(mainBaseUrl, mainCookie, { name: 'Auto Package Name' });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.packageName, 'com.apk.autodetected');
    });

    await test('missing name is rejected with 400', async () => {
      const res = await uploadApk(mainBaseUrl, mainCookie, { packageName: 'com.apk.noname' });
      assert.strictEqual(res.status, 400);
    });

    await test('an invalid category key is rejected with 400', async () => {
      const res = await uploadApk(mainBaseUrl, mainCookie, {
        packageName: 'com.apk.badcat', name: 'Bad Category', category: 'not-a-real-category',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('a missing file field is rejected with 400', async () => {
      const res = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: null, packageName: 'com.apk.nofile', name: 'No File',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('an upload over the 150MB limit is rejected with 413, before any storage/DB write', async () => {
      // 150MB + 1 byte - large but not so large this test suite becomes slow;
      // multer's own byte-counting limit rejects it mid-stream regardless of
      // the declared Content-Length.
      const oversized = Buffer.alloc(150 * 1024 * 1024 + 1);
      oversized.writeUInt8(0x50, 0);
      oversized.writeUInt8(0x4b, 1);
      oversized.writeUInt8(0x03, 2);
      oversized.writeUInt8(0x04, 3);
      const before = workingS3.objects.size;
      const res = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: oversized, packageName: 'com.apk.toobig', name: 'Too Big',
      });
      assert.strictEqual(res.status, 413);
      assert.strictEqual(workingS3.objects.size, before, 'an oversized upload must never reach storage');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.toobig');
      assert.strictEqual(row, undefined);
    });

    // ================= happy path =================

    let uploadedKeyPath = null;

    await test('a valid APK upload succeeds: correct SHA-256, randomized storage key, correct response shape, source APK in catalog', async () => {
      const buffer = fakeApkBuffer(8192, 'happy-path', 'com.apk.happy');
      const expectedSha = sha256(buffer);
      const before = workingS3.objects.size;

      const res = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: buffer, packageName: 'com.apk.happy', name: 'Happy Path App', category: 'tools',
      });
      const responseText = await res.text();
      assert.strictEqual(res.status, 200, responseText);
      const body = JSON.parse(responseText);

      assert.strictEqual(body.packageName, 'com.apk.happy');
      assert.strictEqual(body.name, 'Happy Path App');
      assert.strictEqual(body.sha256, expectedSha, 'server-computed SHA-256 must match the actual bytes');
      assert.strictEqual(body.sizeBytes, buffer.length);
      assert.ok(typeof body.apkUrl === 'string' && body.apkUrl.startsWith('https://cdn.example.com/apks/apps/'));
      assert.match(body.apkUrl, /\/apps\/[0-9a-f-]{36}\.apk$/, 'storage key must be a random uuid, never the original filename');

      assert.strictEqual(workingS3.objects.size, before + 1, 'exactly one object should have been uploaded');
      uploadedKeyPath = new URL(body.apkUrl).pathname.replace(/^\/apks/, '');
      // The fake bucket stores objects keyed by the raw request path
      // (forcePathStyle => "/<bucket>/<key>") - find whichever entry was
      // added by this upload rather than assuming key derivation details.
      const stored = [...workingS3.objects.values()].find(o => o.body.equals(buffer));
      assert.ok(stored, 'the uploaded bytes must be exactly what the fake bucket received');
      assert.strictEqual(stored.contentType, 'application/vnd.android.package-archive');

      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.happy');
      assert.ok(row, 'catalog row must exist');
      assert.strictEqual(row.appSource, 'APK');
      assert.strictEqual(row.apkSha256, expectedSha);
      assert.strictEqual(row.apkSizeBytes, buffer.length);
      assert.strictEqual(row.apkUrl, body.apkUrl);
      assert.strictEqual(row.category, 'tools');
      assert.strictEqual(row.categorySource, 'MANUAL');
    });

    await test('two different uploads get two different randomized storage keys', async () => {
      const res1 = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: fakeApkBuffer(1024, 'key-a', 'com.apk.keya'), packageName: 'com.apk.keya', name: 'Key A',
      });
      const res2 = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: fakeApkBuffer(1024, 'key-b', 'com.apk.keyb'), packageName: 'com.apk.keyb', name: 'Key B',
      });
      const [body1, body2] = await Promise.all([res1.json(), res2.json()]);
      assert.notStrictEqual(body1.apkUrl, body2.apkUrl);
    });

    // ================= sync payload exposure =================

    await test('apkUrl/sha256 appear in device sync for an APK-source app the device is allowed, and never for a Play app', async () => {
      await db.addAppToCatalog('com.apk.playapp', 'A Play App', null, '1.0', Date.now(), 'tools');
      const deviceId = `apk-sync-${crypto.randomUUID()}`;
      const token = crypto.randomBytes(16).toString('hex');
      await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
      await fetch(`${mainBaseUrl}/api/devices/${deviceId}/policy/apps`, {
        method: 'POST',
        headers: { Cookie: mainCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'com.apk.happy' }),
      });
      await fetch(`${mainBaseUrl}/api/devices/${deviceId}/policy/apps`, {
        method: 'POST',
        headers: { Cookie: mainCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'com.apk.playapp' }),
      });
      const syncRes = await fetch(`${mainBaseUrl}/api/devices/${deviceId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      assert.strictEqual(syncRes.status, 200);
      const syncBody = await syncRes.json();
      const apkEntry = syncBody.catalog.find(a => a.packageName === 'com.apk.happy');
      const playEntry = syncBody.catalog.find(a => a.packageName === 'com.apk.playapp');
      assert.ok(apkEntry, 'uploaded app must appear in sync catalog');
      assert.ok(playEntry, 'play app must appear in sync catalog');
      assert.strictEqual(apkEntry.appSource, 'APK');
      assert.ok(apkEntry.apkUrl, 'APK-source app must expose apkUrl');
      assert.ok(apkEntry.apkSha256, 'APK-source app must expose apkSha256');
      assert.strictEqual(playEntry.appSource, 'PLAY');
      assert.strictEqual(playEntry.apkUrl, null, 'a Play app must never expose apkUrl');
      assert.strictEqual(playEntry.apkSha256, null, 'a Play app must never expose apkSha256');
    });

    // ================= storage failure => no DB row =================

    await test('storage failure (unreachable endpoint) => 500 and no catalog row is created', async () => {
      const res = await uploadApk(brokenStorageBaseUrl, brokenStorageCookie, {
        apkBuffer: fakeApkBuffer(1024, 's3-fail', 'com.apk.s3fail'), packageName: 'com.apk.s3fail', name: 'S3 Fail',
      });
      assert.strictEqual(res.status, 500);
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.s3fail');
      assert.strictEqual(row, undefined, 'a failed storage upload must never leave a usable catalog entry');
    });

    await test('missing APK_STORAGE_* configuration fails closed with 500 and no catalog row', async () => {
      const res = await uploadApk(noStorageConfigBaseUrl, noStorageConfigCookie, {
        apkBuffer: fakeApkBuffer(1024, 'no-config', 'com.apk.noconfig'), packageName: 'com.apk.noconfig', name: 'No Config',
      });
      assert.strictEqual(res.status, 500);
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.noconfig');
      assert.strictEqual(row, undefined);
    });

    // ================= DB failure => storage cleanup attempted =================

    await test('a database failure after a successful upload triggers cleanup of the orphaned object', async () => {
      const before = workingS3.objects.size;
      // A real, deterministic Postgres failure: the target table briefly
      // does not exist, so the INSERT inside db.insertUploadedApp() fails
      // with a genuine "relation does not exist" error - not a simulated
      // one - while the storage upload (against the already-working fake
      // S3) has already succeeded.
      await rawPool.query('ALTER TABLE apps_catalog RENAME TO apps_catalog_test_renamed');
      let res;
      try {
        res = await uploadApk(mainBaseUrl, mainCookie, {
          apkBuffer: fakeApkBuffer(1024, 'db-fail', 'com.apk.dbfail'), packageName: 'com.apk.dbfail', name: 'DB Fail',
        });
      } finally {
        await rawPool.query('ALTER TABLE apps_catalog_test_renamed RENAME TO apps_catalog');
      }
      assert.strictEqual(res.status, 500);
      assert.strictEqual(
        workingS3.objects.size, before,
        'the object uploaded just before the DB failure must have been deleted again (no orphan left behind)',
      );
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.dbfail');
      assert.strictEqual(row, undefined);
    });

    // ================= re-upload replaces in place =================

    await test('re-uploading the same packageName updates the existing row rather than duplicating it', async () => {
      const first = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: fakeApkBuffer(512, 'v1', 'com.apk.reupload'), packageName: 'com.apk.reupload', name: 'Reupload V1',
      });
      const firstBody = await first.json();
      const second = await uploadApk(mainBaseUrl, mainCookie, {
        apkBuffer: fakeApkBuffer(512, 'v2', 'com.apk.reupload'), packageName: 'com.apk.reupload', name: 'Reupload V2',
      });
      const secondBody = await second.json();
      assert.notStrictEqual(firstBody.sha256, secondBody.sha256);
      const matches = (await db.listAppsCatalog()).filter(a => a.packageName === 'com.apk.reupload');
      assert.strictEqual(matches.length, 1, 'must not create a duplicate row');
      assert.strictEqual(matches[0].name, 'Reupload V2');
      assert.strictEqual(matches[0].apkSha256, secondBody.sha256);
    });

    // ================= Play catalog regression (unchanged) =================

    await test('regression: adding/listing a plain Play-sourced app is completely unaffected by APK upload support', async () => {
      await db.addAppToCatalog('com.apk.regression.play', 'Regression Play App', 'https://example.com/icon.png', '3.0', Date.now(), 'other');
      const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.apk.regression.play');
      assert.strictEqual(row.appSource, 'PLAY');
      assert.strictEqual(row.apkUrl, null);
      assert.strictEqual(row.apkSha256, null);
      assert.strictEqual(row.apkSizeBytes, null);
      assert.strictEqual(row.uploadedAt, null);

      const listRes = await fetch(`${mainBaseUrl}/api/apps`, { headers: { Cookie: mainCookie } });
      assert.strictEqual(listRes.status, 200);
      const apiRow = (await listRes.json()).find(a => a.packageName === 'com.apk.regression.play');
      assert.strictEqual(apiRow.appSource, 'PLAY');
      assert.strictEqual(apiRow.apkUrl, null);
    });

    // ================= summary =================

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  - ${f.name}: ${f.error.message}`);
    }
  } finally {
    await Promise.allSettled([
      killAndWait(mainServer),
      killAndWait(brokenStorageServer),
      killAndWait(noStorageConfigServer),
    ]);
    await workingS3.close();
    await rawPool.end();
  }
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL (suite could not complete):', e);
  process.exit(1);
});
