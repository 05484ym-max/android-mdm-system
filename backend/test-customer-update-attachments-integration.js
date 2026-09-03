// REAL PostgreSQL + real HTTP integration suite for customer-update
// attachments ("חדשות ועדכונים" images/videos/files/links):
//   POST   /api/customer-updates/:id/attachments
//   POST   /api/customer-updates/:id/attachments/link
//   DELETE /api/customer-updates/:id/attachments/:attachmentId
//   GET    /api/customer-updates/attachments/:attachmentId/download
// and the atomic cascade cleanup on DELETE /api/customer-updates/:id.
//
// Real Postgres, a real running backend/index.js, and - for the uploaded
// file scenarios - a real local HTTP server standing in for the GitHub
// Releases API (fakeGitHubServer.js, the same test double
// test-apk-upload-integration.js/test-app-delete-integration.js already
// use), redirected to via apkStorage.js's NODE_ENV=test-only
// APK_STORAGE_TEST_BASE_URL override. Nothing here is mocked at the
// application layer.
//
// ---------------------------------------------------------------------
// One-time local setup - same appstore_test / appstore_test_user database
// already used by the other integration suites in this directory:
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS appstore_test;" \
//     -c "DROP ROLE IF EXISTS appstore_test_user;" \
//     -c "CREATE ROLE appstore_test_user LOGIN PASSWORD 'appstore_test_pw';" \
//     -c "CREATE DATABASE appstore_test OWNER appstore_test_user;"
//
// From backend/ (this file spawns/kills its own server process):
//
//   (
//     export DATABASE_URL="postgresql://appstore_test_user:appstore_test_pw@127.0.0.1:5432/appstore_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     node test-customer-update-attachments-integration.js
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

async function adminFetch(baseUrl, cookie, urlPath, opts = {}) {
  return fetch(`${baseUrl}${urlPath}`, {
    ...opts,
    headers: { Cookie: cookie, ...(opts.headers || {}) },
  });
}

async function adminJson(baseUrl, cookie, urlPath, opts = {}) {
  return adminFetch(baseUrl, cookie, urlPath, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function createUpdate(baseUrl, cookie, overrides = {}) {
  const res = await adminJson(baseUrl, cookie, '/api/customer-updates', {
    method: 'POST',
    body: JSON.stringify({ title: 'Attachment test', body: 'body', ...overrides }),
  });
  // Read the body exactly once - assert's own diagnostic argument is
  // evaluated eagerly regardless of pass/fail, so building it from
  // res.text() here and then calling res.json() on the same response
  // would throw "Body is unusable" even on the success path.
  const text = await res.text();
  assert.strictEqual(res.status, 200, `creating the test update should succeed: ${text}`);
  return JSON.parse(text);
}

async function getUpdate(baseUrl, cookie, id) {
  const list = await (await adminFetch(baseUrl, cookie, '/api/customer-updates')).json();
  const found = list.find(u => u.id === id);
  assert.ok(found, `update ${id} should exist in the admin list`);
  return found;
}

function uploadForm(buffer, filename, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  return form;
}

async function uploadAttachment(baseUrl, cookie, updateId, buffer, filename, mimeType) {
  return fetch(`${baseUrl}/api/customer-updates/${encodeURIComponent(updateId)}/attachments`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: uploadForm(buffer, filename, mimeType),
  });
}

async function addLinkAttachment(baseUrl, cookie, updateId, body) {
  return adminJson(baseUrl, cookie, `/api/customer-updates/${encodeURIComponent(updateId)}/attachments/link`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Device auth is never exercised beyond the one "attachments reach the
// device feed" scenario below.
async function createTestDevice(label) {
  const deviceId = `attach-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
  return { deviceId, token };
}

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE customer_updates, devices RESTART IDENTITY CASCADE`);
}

(async () => {
  const github = await startFakeGitHubServer();

  const mainPort = 4371;
  const mainBase = `http://127.0.0.1:${mainPort}`;
  const main = spawnServer(mainPort, {
    GITHUB_APK_TOKEN: 'test-token',
    APK_STORAGE_TEST_BASE_URL: github.baseUrl,
  });

  try {
    await waitForHealth(mainBase, main);
    await db.init();
    await resetTestDatabase();
    const cookie = await login(mainBase);

    // ================= validation =================

    await test('uploading a file to a nonexistent update returns 404', async () => {
      const fakeId = crypto.randomUUID();
      const res = await uploadAttachment(mainBase, cookie, fakeId, Buffer.from('x'), 'a.png', 'image/png');
      assert.strictEqual(res.status, 404);
    });

    await test('uploading with a malformed update id returns 400', async () => {
      const res = await uploadAttachment(mainBase, cookie, 'not-a-uuid', Buffer.from('x'), 'a.png', 'image/png');
      assert.strictEqual(res.status, 400);
    });

    await test('uploading with no file field returns 400', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await fetch(`${mainBase}/api/customer-updates/${update.id}/attachments`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: new FormData(),
      });
      assert.strictEqual(res.status, 400);
    });

    // ================= kind classification =================

    await test('an image upload is stored as kind IMAGE and is downloadable', async () => {
      const update = await createUpdate(mainBase, cookie);
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
      const res = await uploadAttachment(mainBase, cookie, update.id, bytes, 'photo.png', 'image/png');
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.kind, 'IMAGE');
      assert.strictEqual(body.filename, 'photo.png');
      assert.strictEqual(body.mimeType, 'image/png');
      assert.strictEqual(body.sizeBytes, bytes.length);
      assert.ok(body.url.includes(`/api/customer-updates/attachments/${body.id}/download`));

      const dl = await fetch(body.url);
      assert.strictEqual(dl.status, 200);
      assert.strictEqual(dl.headers.get('content-type'), 'image/png');
      const dlBytes = Buffer.from(await dl.arrayBuffer());
      assert.deepStrictEqual(dlBytes, bytes);
    });

    await test('a video upload is stored as kind VIDEO', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await uploadAttachment(mainBase, cookie, update.id, Buffer.from('fake-video-bytes'), 'clip.mp4', 'video/mp4');
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.kind, 'VIDEO');
    });

    await test('a non-image/video upload is stored as kind FILE, any type accepted', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await uploadAttachment(mainBase, cookie, update.id, Buffer.from('%PDF-1.4 fake'), 'flyer.pdf', 'application/pdf');
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.kind, 'FILE');
      assert.strictEqual(body.filename, 'flyer.pdf');
    });

    // ================= links =================

    await test('a link attachment is stored as kind LINK with url and label', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await addLinkAttachment(mainBase, cookie, update.id, {
        url: 'https://example.com/promo', label: 'מבצע מיוחד',
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.kind, 'LINK');
      assert.strictEqual(body.url, 'https://example.com/promo');
      assert.strictEqual(body.label, 'מבצע מיוחד');
    });

    await test('a link attachment rejects a non-http(s) url', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await addLinkAttachment(mainBase, cookie, update.id, { url: 'javascript:alert(1)' });
      assert.strictEqual(res.status, 400);
    });

    await test('a link attachment rejects a missing url', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await addLinkAttachment(mainBase, cookie, update.id, { label: 'no url here' });
      assert.strictEqual(res.status, 400);
    });

    // ================= per-update cap =================

    await test('an update may have at most 10 attachments - the 11th is rejected', async () => {
      const update = await createUpdate(mainBase, cookie);
      for (let i = 0; i < 10; i++) {
        const res = await addLinkAttachment(mainBase, cookie, update.id, { url: `https://example.com/${i}` });
        assert.strictEqual(res.status, 200, `attachment ${i} should succeed`);
      }
      const res = await addLinkAttachment(mainBase, cookie, update.id, { url: 'https://example.com/eleventh' });
      assert.strictEqual(res.status, 400);
      const fetched = await getUpdate(mainBase, cookie, update.id);
      assert.strictEqual(fetched.attachments.length, 10, 'the 11th attempt must not have been stored');
    });

    // ================= deleting one attachment =================

    await test('deleting one attachment removes it and its GitHub asset, without touching a sibling attachment', async () => {
      const update = await createUpdate(mainBase, cookie);
      const keepBytes = Buffer.from('keep-me');
      const removeBytes = Buffer.from('remove-me');
      const keep = await (await uploadAttachment(mainBase, cookie, update.id, keepBytes, 'keep.bin', 'application/octet-stream')).json();
      const remove = await (await uploadAttachment(mainBase, cookie, update.id, removeBytes, 'remove.bin', 'application/octet-stream')).json();
      assert.notStrictEqual(keep.url, remove.url);

      const res = await adminFetch(mainBase, cookie, `/api/customer-updates/${update.id}/attachments/${remove.id}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 200);

      const fetched = await getUpdate(mainBase, cookie, update.id);
      assert.strictEqual(fetched.attachments.length, 1);
      assert.strictEqual(fetched.attachments[0].id, keep.id);

      const removedDownload = await fetch(remove.url);
      assert.strictEqual(removedDownload.status, 404, 'the removed attachment must 404, its GitHub asset is gone');
      const keptDownload = await fetch(keep.url);
      assert.strictEqual(keptDownload.status, 200, 'the sibling attachment must be untouched');
    });

    await test('deleting an attachment through the wrong update id 404s and does not delete it', async () => {
      const updateA = await createUpdate(mainBase, cookie);
      const updateB = await createUpdate(mainBase, cookie);
      const att = await (await addLinkAttachment(mainBase, cookie, updateA.id, { url: 'https://example.com/a' })).json();

      const res = await adminFetch(mainBase, cookie, `/api/customer-updates/${updateB.id}/attachments/${att.id}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 404);

      const fetched = await getUpdate(mainBase, cookie, updateA.id);
      assert.strictEqual(fetched.attachments.length, 1, 'the attachment must still belong to update A, untouched');
    });

    // ================= deleting the whole update cascades =================

    await test('deleting an update cascades to all its attachments and their GitHub assets, including a mix of files and links', async () => {
      const update = await createUpdate(mainBase, cookie);
      const fileAtt = await (await uploadAttachment(mainBase, cookie, update.id, Buffer.from('cascade-me'), 'x.bin', 'application/octet-stream')).json();
      // A link attachment (no GitHub asset at all) alongside the file one -
      // this is exactly what proves the cleanup loop correctly skips
      // storage-less rows instead of erroring on them.
      await addLinkAttachment(mainBase, cookie, update.id, { url: 'https://example.com/cascade' });

      const res = await adminFetch(mainBase, cookie, `/api/customer-updates/${update.id}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 200);

      const list = await (await adminFetch(mainBase, cookie, '/api/customer-updates')).json();
      assert.ok(!list.some(u => u.id === update.id), 'the update itself must be gone');

      const fileDownload = await fetch(fileAtt.url);
      assert.strictEqual(fileDownload.status, 404, 'the file attachment\'s GitHub asset must have been cleaned up');
    });

    await test('deleting an update with zero attachments still succeeds (no storage calls to fail)', async () => {
      const update = await createUpdate(mainBase, cookie);
      const res = await adminFetch(mainBase, cookie, `/api/customer-updates/${update.id}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 200);
    });

    // ================= download route edge cases =================

    await test('the download route 400s on a malformed attachment id', async () => {
      const res = await fetch(`${mainBase}/api/customer-updates/attachments/not-a-uuid/download`);
      assert.strictEqual(res.status, 400);
    });

    await test('the download route 404s for a LINK attachment (no file to stream)', async () => {
      const update = await createUpdate(mainBase, cookie);
      const link = await (await addLinkAttachment(mainBase, cookie, update.id, { url: 'https://example.com/nofile' })).json();
      const res = await fetch(`${mainBase}/api/customer-updates/attachments/${link.id}/download`);
      assert.strictEqual(res.status, 404);
    });

    await test('the download route 404s for a nonexistent attachment id', async () => {
      const res = await fetch(`${mainBase}/api/customer-updates/attachments/${crypto.randomUUID()}/download`);
      assert.strictEqual(res.status, 404);
    });

    // ================= device feed carries attachments =================

    await test('a published update\'s attachments reach the device-facing feed; an unpublished one\'s never do', async () => {
      const published = await createUpdate(mainBase, cookie, { published: true });
      await uploadAttachment(mainBase, cookie, published.id, Buffer.from('device-visible'), 'p.png', 'image/png');
      await addLinkAttachment(mainBase, cookie, published.id, { url: 'https://example.com/device' });

      const draft = await createUpdate(mainBase, cookie, { published: false });
      await addLinkAttachment(mainBase, cookie, draft.id, { url: 'https://example.com/hidden' });

      const { deviceId, token } = await createTestDevice('feed');
      const res = await fetch(`${mainBase}/api/devices/${encodeURIComponent(deviceId)}/updates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(res.status, 200);
      const feed = await res.json();

      const publishedInFeed = feed.find(u => u.id === published.id);
      assert.ok(publishedInFeed, 'the published update must be in the device feed');
      assert.strictEqual(publishedInFeed.attachments.length, 2);
      assert.ok(publishedInFeed.attachments.some(a => a.kind === 'IMAGE'));
      assert.ok(publishedInFeed.attachments.some(a => a.kind === 'LINK' && a.url === 'https://example.com/device'));

      assert.ok(!feed.some(u => u.id === draft.id), 'the unpublished update must never appear in the device feed at all');
    });

    // ================= summary =================

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      for (const f of failures) console.log(`- ${f.name}: ${f.error.message}`);
    }
  } finally {
    await stop(main);
    await github.close();
    await rawPool.end();
  }

  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e);
  try { await rawPool.end(); } catch { /* ignore */ }
  process.exit(1);
});
