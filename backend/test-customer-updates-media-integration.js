'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');
const { startFakeGitHubServer } = require('./fakeGitHubServer');

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

function sha256(v) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

function spawnServer(port, githubBase) {
  return spawn(process.execPath, [path.join(__dirname, 'index.js')], {
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
      GITHUB_APK_TOKEN: 'test-token',
      GITHUB_APK_REPOSITORY: 'test-owner/test-repo',
      GITHUB_APK_RELEASE_TAG: 'app-store-assets',
      APK_STORAGE_TEST_BASE_URL: githubBase,
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHealth(baseUrl, proc, timeoutMs = 20000) {
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`server exited early: ${stderr}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy: ${stderr}`);
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

function pngBytes(extra = 64) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 0x41),
  ]);
}

function mp4Bytes(extra = 128) {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.alloc(extra, 0x42),
  ]);
}

function updateForm({ title, body, pinned, published, media, mediaType, filename, removeMedia } = {}) {
  const form = new FormData();
  if (title !== undefined) form.append('title', title);
  if (body !== undefined) form.append('body', body);
  if (pinned !== undefined) form.append('pinned', String(pinned));
  if (published !== undefined) form.append('published', String(published));
  if (removeMedia !== undefined) form.append('removeMedia', String(removeMedia));
  if (media) form.append('media', new Blob([media], { type: mediaType }), filename || 'media.bin');
  return form;
}

async function adminMultipart(baseUrl, cookie, route, method, form) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
  });
}

(async () => {
  const github = await startFakeGitHubServer();
  const port = 4361;
  const base = `http://127.0.0.1:${port}`;
  const server = spawnServer(port, github.baseUrl);

  try {
    await waitForHealth(base, server);
    await db.init();
    await rawPool.query(
      'TRUNCATE customer_updates, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE'
    );
    const cookie = await login(base);

    await test('JSON-only customer update remains backward-compatible', async () => {
      const res = await fetch(`${base}/api/customer-updates`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'טקסט בלבד', body: 'ללא מדיה', published: false }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.mediaType, null);
      assert.strictEqual(body.mediaUrl, null);
    });

    await test('unauthenticated media upload is rejected before any release asset is created', async () => {
      const before = github.assets.size;
      const res = await adminMultipart(base, null, '/api/customer-updates', 'POST',
        updateForm({
          title: 'ללא הרשאה', body: 'בדיקה', media: pngBytes(),
          mediaType: 'image/png', filename: 'x.png',
        }));
      assert.strictEqual(res.status, 401);
      assert.strictEqual(github.assets.size, before);
    });

    await test('unsupported media bytes are rejected and not stored', async () => {
      const before = github.assets.size;
      const res = await adminMultipart(base, cookie, '/api/customer-updates', 'POST',
        updateForm({
          title: 'קובץ רע', body: 'בדיקה', media: Buffer.from('not-media'),
          mediaType: 'image/png', filename: 'fake.png',
        }));
      assert.strictEqual(res.status, 400);
      assert.strictEqual(github.assets.size, before);
    });

    await test('oversized image is rejected before GitHub storage', async () => {
      const before = github.assets.size;
      const large = Buffer.concat([pngBytes(0), Buffer.alloc(10 * 1024 * 1024 + 1)]);
      const res = await adminMultipart(base, cookie, '/api/customer-updates', 'POST',
        updateForm({
          title: 'תמונה גדולה', body: 'בדיקה', media: large,
          mediaType: 'image/png', filename: 'large.png',
        }));
      assert.strictEqual(res.status, 413);
      assert.strictEqual(github.assets.size, before);
    });

    let mediaUpdateId;
    let imageAssetId;
    const image = pngBytes(80);

    await test('published image update stores metadata and reaches every device feed', async () => {
      const res = await adminMultipart(base, cookie, '/api/customer-updates', 'POST',
        updateForm({
          title: 'עדכון עם תמונה', body: 'תוכן', pinned: true, published: true,
          media: image, mediaType: 'image/png', filename: 'photo.png',
        }));
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      mediaUpdateId = body.id;
      assert.strictEqual(body.mediaType, 'IMAGE');
      assert.strictEqual(body.mediaMimeType, 'image/png');
      assert.strictEqual(body.mediaSizeBytes, image.length);
      assert.ok(body.mediaUrl.startsWith(`${base}/api/customer-updates/media/`));
      imageAssetId = body.mediaUrl.split('/').pop();
      assert.ok(github.assets.has(imageAssetId));
      assert.strictEqual(github.assets.get(imageAssetId).contentType, 'image/png');

      const deviceId = 'news-media-device-' + crypto.randomUUID();
      const token = crypto.randomBytes(16).toString('hex');
      await rawPool.query(
        'INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)',
        [deviceId, sha256(token)],
      );
      const feedRes = await fetch(`${base}/api/devices/${encodeURIComponent(deviceId)}/updates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.strictEqual(feedRes.status, 200);
      const feed = await feedRes.json();
      const item = feed.find(x => x.id === mediaUpdateId);
      assert.ok(item);
      assert.strictEqual(item.mediaType, 'IMAGE');
      assert.strictEqual(item.mediaUrl, body.mediaUrl);
      assert.strictEqual(item.mediaMimeType, 'image/png');

      const mediaRes = await fetch(body.mediaUrl);
      assert.strictEqual(mediaRes.status, 200);
      assert.strictEqual(mediaRes.headers.get('content-type'), 'image/png');
      assert.deepStrictEqual(Buffer.from(await mediaRes.arrayBuffer()), image);
    });

    let videoAssetId;
    const video = mp4Bytes(160);

    await test('editing replaces image with video and removes only the old asset', async () => {
      const keepAssetCountBefore = github.assets.size;
      const res = await adminMultipart(
        base, cookie, `/api/customer-updates/${mediaUpdateId}`, 'PUT',
        updateForm({ media: video, mediaType: 'video/mp4', filename: 'clip.mp4' }),
      );
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.mediaType, 'VIDEO');
      assert.strictEqual(body.mediaMimeType, 'video/mp4');
      videoAssetId = body.mediaUrl.split('/').pop();
      assert.notStrictEqual(videoAssetId, imageAssetId);
      assert.strictEqual(github.assets.has(imageAssetId), false);
      assert.strictEqual(github.assets.has(videoAssetId), true);
      assert.strictEqual(github.assets.size, keepAssetCountBefore);
    });

    await test('video proxy supports byte ranges for on-demand playback', async () => {
      const list = await (await fetch(`${base}/api/customer-updates`, {
        headers: { Cookie: cookie },
      })).json();
      const item = list.find(x => x.id === mediaUpdateId);
      const res = await fetch(item.mediaUrl, { headers: { Range: 'bytes=4-11' } });
      assert.strictEqual(res.status, 206);
      assert.strictEqual(res.headers.get('content-type'), 'video/mp4');
      assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
      assert.strictEqual(res.headers.get('content-range'), `bytes 4-11/${video.length}`);
      assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), video.subarray(4, 12));
    });

    await test('removeMedia clears DB metadata and deletes the video asset', async () => {
      const res = await adminMultipart(
        base, cookie, `/api/customer-updates/${mediaUpdateId}`, 'PUT',
        updateForm({ removeMedia: true }),
      );
      const body = await res.json();
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual(body.mediaType, null);
      assert.strictEqual(body.mediaUrl, null);
      assert.strictEqual(body.mediaStorageKey, null);
      assert.strictEqual(github.assets.has(videoAssetId), false);
    });

    await test('deleting an update also deletes its attached media asset', async () => {
      const create = await adminMultipart(base, cookie, '/api/customer-updates', 'POST',
        updateForm({
          title: 'למחיקה', body: 'עם תמונה', media: pngBytes(20),
          mediaType: 'image/png', filename: 'delete.png',
        }));
      const created = await create.json();
      assert.strictEqual(create.status, 200, JSON.stringify(created));
      const assetId = created.mediaUrl.split('/').pop();
      assert.ok(github.assets.has(assetId));

      const del = await fetch(`${base}/api/customer-updates/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
      assert.strictEqual(del.status, 200);
      assert.strictEqual(github.assets.has(assetId), false);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      for (const failure of failures) {
        console.log(`- ${failure.name}: ${failure.error.message}`);
      }
    }
  } finally {
    await stop(server);
    await github.close();
    await rawPool.end();
  }

  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('FATAL:', e);
  try { await rawPool.end(); } catch {}
  process.exit(1);
});
