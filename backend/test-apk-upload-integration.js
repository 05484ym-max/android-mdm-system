'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeGitHubServer } = require('./fakeGitHubServer');
const { buildTestApk } = require('./testApkFixture');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
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
    } catch {}
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
  if (buffer !== null) {
    form.append(
      'apk',
      new Blob([buffer || buildTestApk(packageName || 'com.example.auto', 4096)], {
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

async function upload(baseUrl, cookie, opts) {
  return fetch(`${baseUrl}/api/apps/upload-apk`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: uploadForm(opts),
  });
}

(async () => {
  const github = await startFakeGitHubServer();

  const mainPort = 4351;
  const brokenPort = 4352;
  const noTokenPort = 4353;
  const mainBase = `http://127.0.0.1:${mainPort}`;
  const brokenBase = `http://127.0.0.1:${brokenPort}`;
  const noTokenBase = `http://127.0.0.1:${noTokenPort}`;

  const main = spawnServer(mainPort, {
    GITHUB_APK_TOKEN: 'test-token',
    APK_STORAGE_TEST_BASE_URL: github.baseUrl,
  });
  let broken = null;
  let noToken = null;

  try {
    // Initialise the shared test schema through one backend first. Starting
    // three db.init() calls against a brand-new PostgreSQL schema at the
    // exact same instant can race inside CREATE TABLE IF NOT EXISTS itself.
    await waitForHealth(mainBase, main);
    await db.init();

    broken = spawnServer(brokenPort, {
      GITHUB_APK_TOKEN: 'test-token',
      APK_STORAGE_TEST_BASE_URL: 'http://127.0.0.1:1',
    });
    await waitForHealth(brokenBase, broken);

    noToken = spawnServer(noTokenPort, {
      GITHUB_APK_TOKEN: '',
      APK_STORAGE_TEST_BASE_URL: github.baseUrl,
    });
    await waitForHealth(noTokenBase, noToken);

    await rawPool.query(
      'TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE'
    );

    const cookie = await login(mainBase);
    const brokenCookie = await login(brokenBase);
    const noTokenCookie = await login(noTokenBase);

    await test('unauthenticated upload is rejected', async () => {
      const before = github.assets.size;
      const res = await upload(mainBase, null, { name: 'No auth' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(github.assets.size, before);
    });

    await test('non-APK bytes are rejected', async () => {
      const res = await upload(mainBase, cookie, {
        buffer: Buffer.from('not an apk'),
        name: 'Bad',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('package name is auto-detected from AndroidManifest.xml', async () => {
      const apk = buildTestApk('org.yehudikasher.browser', 4096);
      const res = await upload(mainBase, cookie, { buffer: apk, name: 'Browser' });
      const text = await res.text();
      assert.strictEqual(res.status, 200, text);
      const body = JSON.parse(text);
      assert.strictEqual(body.packageName, 'org.yehudikasher.browser');
    });

    await test('a supplied package name that disagrees with the APK is rejected', async () => {
      const apk = buildTestApk('com.real.package', 4096);
      const res = await upload(mainBase, cookie, {
        buffer: apk,
        packageName: 'com.wrong.package',
        name: 'Mismatch',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('missing app name is rejected', async () => {
      const res = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.noname', 4096),
      });
      assert.strictEqual(res.status, 400);
    });

    await test('invalid category is rejected', async () => {
      const res = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.badcat', 4096),
        name: 'Bad category',
        category: 'definitely-not-valid',
      });
      assert.strictEqual(res.status, 400);
    });

    await test('missing APK field is rejected', async () => {
      const res = await upload(mainBase, cookie, { buffer: null, name: 'Missing' });
      assert.strictEqual(res.status, 400);
    });

    await test('valid upload creates a GitHub release asset and catalog row with exact SHA/size', async () => {
      const iconBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 11, 22, 33, 44]);
      const apk = buildTestApk('com.example.good', 8192, { buffer: iconBytes });
      const res = await upload(mainBase, cookie, {
        buffer: apk,
        name: 'Good App',
        category: 'tools',
      });
      const text = await res.text();
      if (res.status !== 200) {
        console.log(`  response body: ${text}`);
        console.log(`  server stderr: ${main.testStderr}`);
      }
      assert.strictEqual(res.status, 200, text);
      const body = JSON.parse(text);

      assert.strictEqual(body.packageName, 'com.example.good');
      assert.strictEqual(body.sha256, sha256(apk));
      assert.strictEqual(body.sizeBytes, apk.length);
      assert.ok(body.apkUrl.startsWith(`${mainBase}/api/apps/apk/`));
      assert.match(body.apkUrl.split('/').pop(), /^\d+$/);
      assert.ok(body.iconUrl.startsWith(`${mainBase}/api/apps/icon/`));
      assert.match(body.iconUrl.split('/').pop(), /^\d+$/);

      assert.ok(github.release, 'release should be created');
      assert.strictEqual(github.assets.size >= 1, true);

      const row = (await db.listAppsCatalog()).find(x => x.packageName === 'com.example.good');
      assert.ok(row);
      assert.strictEqual(row.appSource, 'APK');
      assert.strictEqual(row.apkSha256, sha256(apk));
      assert.strictEqual(row.apkSizeBytes, apk.length);
      assert.strictEqual(row.iconUrl, body.iconUrl);
      assert.ok(row.apkIconStorageKey);

      const iconAssetId = body.iconUrl.split('/').pop();
      const storedIconAsset = github.assets.get(iconAssetId);
      assert.ok(storedIconAsset, 'uploaded icon asset should exist');
      // GitHub Release downloads can arrive as application/octet-stream even
      // when the asset was uploaded as image/png. The public icon proxy must
      // identify the image from its bytes instead of trusting that transport
      // header, otherwise the admin panel falls back to the app's first letter.
      storedIconAsset.contentType = 'application/octet-stream';

      const iconProxy = await fetch(body.iconUrl);
      assert.strictEqual(iconProxy.status, 200);
      assert.strictEqual(iconProxy.headers.get('content-type'), 'image/png');
      assert.deepStrictEqual(Buffer.from(await iconProxy.arrayBuffer()), iconBytes);

      const proxy = await fetch(body.apkUrl);
      assert.strictEqual(proxy.status, 200);
      const downloaded = Buffer.from(await proxy.arrayBuffer());
      assert.deepStrictEqual(downloaded, apk);
    });

    await test('two packages receive different release asset IDs/names', async () => {
      const a = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.a', 4096),
        name: 'A',
      });
      const b = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.b', 4096),
        name: 'B',
      });
      assert.strictEqual(a.status, 200);
      assert.strictEqual(b.status, 200);
      const aj = await a.json();
      const bj = await b.json();
      assert.notStrictEqual(aj.apkUrl, bj.apkUrl);
      const names = [...github.assets.values()].map(x => x.name);
      assert.strictEqual(new Set(names).size, names.length);
    });

    await test('re-uploading the same package replaces catalog asset and removes the old asset', async () => {
      const first = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.replace', 4096, {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]),
        }),
        name: 'Replace v1',
      });
      assert.strictEqual(first.status, 200);
      const firstJson = await first.json();
      const oldId = firstJson.apkUrl.split('/').pop();
      const oldIconId = firstJson.iconUrl.split('/').pop();
      assert.ok(github.assets.has(oldId));
      assert.ok(github.assets.has(oldIconId));

      const second = await upload(mainBase, cookie, {
        buffer: buildTestApk('com.example.replace', 5000, {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 2, 2, 2]),
        }),
        name: 'Replace v2',
      });
      assert.strictEqual(second.status, 200);
      const secondJson = await second.json();
      const newId = secondJson.apkUrl.split('/').pop();
      const newIconId = secondJson.iconUrl.split('/').pop();
      assert.notStrictEqual(oldId, newId);
      assert.notStrictEqual(oldIconId, newIconId);
      assert.strictEqual(github.assets.has(oldId), false);
      assert.strictEqual(github.assets.has(oldIconId), false);
      assert.strictEqual(github.assets.has(newId), true);
      assert.strictEqual(github.assets.has(newIconId), true);

      const matches = (await db.listAppsCatalog()).filter(x => x.packageName === 'com.example.replace');
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].name, 'Replace v2');
    });

    await test('unreachable GitHub storage fails closed and writes no catalog row', async () => {
      const res = await upload(brokenBase, brokenCookie, {
        buffer: buildTestApk('com.example.storagefail', 4096),
        name: 'Storage fail',
      });
      assert.strictEqual(res.status, 500);
      const row = (await db.listAppsCatalog()).find(x => x.packageName === 'com.example.storagefail');
      assert.strictEqual(row, undefined);
    });

    await test('missing GitHub token fails closed and writes no catalog row', async () => {
      const res = await upload(noTokenBase, noTokenCookie, {
        buffer: buildTestApk('com.example.notoken', 4096),
        name: 'No token',
      });
      assert.strictEqual(res.status, 500);
      const row = (await db.listAppsCatalog()).find(x => x.packageName === 'com.example.notoken');
      assert.strictEqual(row, undefined);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      for (const failure of failures) {
        console.log(`- ${failure.name}: ${failure.error.message}`);
      }
    }
  } finally {
    await Promise.all([stop(main), stop(broken), stop(noToken)]);
    await github.close();
    await rawPool.end();
  }

  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e);
  try { await rawPool.end(); } catch {}
  process.exit(1);
});
