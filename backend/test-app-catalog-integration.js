// REAL PostgreSQL integration suite for the App Store categories/search/
// recommended/sort feature (branch app-store-categories). Real local
// Postgres, a real running backend/index.js over real HTTP - nothing here
// is mocked. google-play-scraper/Google Play itself is NOT reachable from
// this sandbox (outbound network policy denies play.google.com - verified
// directly, see docs/app-store-catalog.md's "What could not be verified"
// section), so the "category suggested from Play" scenarios exercise the
// exact same db.addAppToCatalog code path a real Play fetch would call,
// with a category value equivalent to what playStoreSearch.js's
// categoryFromPlayGenreId would have produced - this proves the storage/
// override-protection logic for real; it does not prove Google Play
// actually returns a usable genreId today (see appCategories.js's own unit
// tests in test-app-categories.js for the mapping logic itself, which
// needs no network).
//
// ---------------------------------------------------------------------
// One-time local setup:
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS appstore_test;" \
//     -c "DROP ROLE IF EXISTS appstore_test_user;" \
//     -c "CREATE ROLE appstore_test_user LOGIN PASSWORD 'appstore_test_pw';" \
//     -c "CREATE DATABASE appstore_test OWNER appstore_test_user;"
//
// From backend/, in one shell:
//
//   (
//     export DATABASE_URL="postgresql://appstore_test_user:appstore_test_pw@127.0.0.1:5432/appstore_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4341 TEST_BASE_URL=http://127.0.0.1:4341
//     node index.js > /tmp/server-appstore.log 2>&1 &
//     SERVER_PID=$!
//     node test-app-catalog-integration.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4341';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const appCategories = require('./appCategories');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
rawPool.on('error', err => {
  console.error('idle test pool error:', err.message);
});

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

async function createTestDevice(label) {
  const deviceId = `asc-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
  return { deviceId, token };
}

let adminCookie = null;
async function adminLogin() {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin login failed: HTTP ${res.status}`);
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('login succeeded but no Set-Cookie header was returned');
  adminCookie = setCookie.split(';')[0];
}

async function adminFetch(path, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function sync(deviceId, token, body = {}) {
  return fetch(`${BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function assignApp(deviceId, packageName) {
  const res = await adminFetch(`/api/devices/${encodeURIComponent(deviceId)}/policy/apps`, {
    method: 'POST',
    body: JSON.stringify({ packageName }),
  });
  if (!res.ok) throw new Error(`assigning ${packageName} to ${deviceId} failed: HTTP ${res.status}`);
}

async function resetTestDatabase() {
  await rawPool.query(`
    TRUNCATE apps_catalog, commands, alerts, enrollments, devices
    RESTART IDENTITY CASCADE
  `);
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();
  await adminLogin();

  // ================= 1: existing app without category defaults to "other" =================

  await test('1. an app row inserted with no category (simulating a pre-migration row) defaults to "other" via the API', async () => {
    // Insert exactly like the OLD addAppToCatalog signature would have
    // (no category argument at all) - the column default is what has to
    // carry this, not application code.
    await db.addAppToCatalog('com.asc.legacy1', 'Legacy App', null);
    const catalog = await db.listAppsCatalog();
    const row = catalog.find(a => a.packageName === 'com.asc.legacy1');
    assert.ok(row, 'the app must exist in the catalog');
    assert.strictEqual(row.category, 'other');
    assert.strictEqual(row.categorySource, 'DEFAULT');

    const listRes = await adminFetch('/api/apps');
    const apiRow = (await listRes.json()).find(a => a.packageName === 'com.asc.legacy1');
    assert.strictEqual(apiRow.category, 'other', 'category must never be null from the API perspective');
  });

  // ================= 2: add app from Play with category when available =================

  await test('2. adding an app with a Play-derived category stores it with source PLAY', async () => {
    // Simulates exactly what index.js's /api/apps/from-play route does with
    // a real playStoreSearch.getPlayStoreApp() result - same call, same
    // arguments shape, a category value equivalent to what
    // categoryFromPlayGenreId('COMMUNICATION') produces (see
    // test-app-categories.js for that mapping's own unit tests; real
    // network access to Google Play is not available in this sandbox).
    await db.addAppToCatalog('com.asc.playapp', 'Play App', 'https://example.com/icon.png', '1.2.3', Date.now(), 'communication');
    const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.playapp');
    assert.strictEqual(row.category, 'communication');
    assert.strictEqual(row.categorySource, 'PLAY');
    assert.strictEqual(row.playVersion, '1.2.3');
  });

  await test('2b. adding an app from Play with NO reliable category (genre unmapped) defaults to "other"/DEFAULT', async () => {
    await db.addAppToCatalog('com.asc.playapp.nogenre', 'Play App No Genre', null, '2.0', Date.now(), null);
    const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.playapp.nogenre');
    assert.strictEqual(row.category, 'other');
    assert.strictEqual(row.categorySource, 'DEFAULT');
  });

  // ================= 3: manual category update =================

  await test('3. an admin can manually set a category via POST /api/apps/:packageName/catalog-meta', async () => {
    const res = await adminFetch('/api/apps/com.asc.legacy1/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ category: 'tools' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.category, 'tools');
    assert.strictEqual(body.categorySource, 'MANUAL');

    const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    assert.strictEqual(row.category, 'tools');
    assert.strictEqual(row.categorySource, 'MANUAL');
  });

  // ================= 4: manual category is not overwritten by later refresh =================

  await test('4. a manually-set category survives a later Play metadata refresh (addAppToCatalog with a different suggestion)', async () => {
    // com.asc.legacy1 is now MANUAL/tools (test 3). Simulate a later Play
    // refresh that would have suggested a totally different category
    // ("finance") - the manual choice must win outright.
    await db.addAppToCatalog('com.asc.legacy1', 'Legacy App', 'https://example.com/new-icon.png', '9.9', Date.now(), 'finance');
    const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    assert.strictEqual(row.category, 'tools', 'manual category must never be overwritten by a later refresh suggestion');
    assert.strictEqual(row.categorySource, 'MANUAL');
    // Non-category fields from the refresh must still apply normally -
    // manual protection is scoped to category/category_source only.
    assert.strictEqual(row.playVersion, '9.9');
    assert.strictEqual(row.iconUrl, 'https://example.com/new-icon.png');
  });

  await test('4b. a PLAY-sourced category IS updated by a later refresh with a new suggestion (only MANUAL is protected)', async () => {
    // com.asc.playapp is PLAY/communication (test 2). A later refresh
    // suggesting "tools" must actually apply, since nothing manual ever
    // happened to this row.
    await db.addAppToCatalog('com.asc.playapp', 'Play App', null, '1.3.0', Date.now(), 'tools');
    const row = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.playapp');
    assert.strictEqual(row.category, 'tools');
    assert.strictEqual(row.categorySource, 'PLAY');
  });

  // ================= 5: invalid category rejected =================

  await test('5. an invalid category value is rejected with 400 and never reaches the DB', async () => {
    const before = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    const res = await adminFetch('/api/apps/com.asc.legacy1/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ category: 'sports' }), // not one of the fixed 12 keys
    });
    assert.strictEqual(res.status, 400);
    const after = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    assert.deepStrictEqual(after, before, 'a rejected category must never modify the row at all');
  });

  await test('5b. "הכל"/"all" (the UI-only filter value) is rejected as a real category too', async () => {
    for (const bad of ['all', 'הכל', '', 123, null, true, ['games']]) {
      const res = await adminFetch('/api/apps/com.asc.legacy1/catalog-meta', {
        method: 'POST',
        body: JSON.stringify({ category: bad }),
      });
      assert.strictEqual(res.status, 400, `category=${JSON.stringify(bad)} must be rejected`);
    }
  });

  // ================= 6: recommended toggle =================

  await test('6. an admin can toggle isRecommended independently of category', async () => {
    const res = await adminFetch('/api/apps/com.asc.playapp/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ isRecommended: true }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.isRecommended, true);
    assert.strictEqual(body.category, 'tools', 'category must be untouched by an isRecommended-only update');
  });

  await test('6b. a non-boolean isRecommended is rejected with 400', async () => {
    const res = await adminFetch('/api/apps/com.asc.playapp/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ isRecommended: 'yes' }),
    });
    assert.strictEqual(res.status, 400);
  });

  // ================= 7: sortOrder update =================

  await test('7. an admin can set sortOrder, and results reorder accordingly', async () => {
    await db.addAppToCatalog('com.asc.sort.a', 'Sort A', null);
    await db.addAppToCatalog('com.asc.sort.b', 'Sort B', null);
    await adminFetch('/api/apps/com.asc.sort.b/catalog-meta', { method: 'POST', body: JSON.stringify({ sortOrder: 1 }) });
    await adminFetch('/api/apps/com.asc.sort.a/catalog-meta', { method: 'POST', body: JSON.stringify({ sortOrder: 2 }) });
    const catalog = await db.listAppsCatalog();
    const idxA = catalog.findIndex(a => a.packageName === 'com.asc.sort.a');
    const idxB = catalog.findIndex(a => a.packageName === 'com.asc.sort.b');
    assert.ok(idxB < idxA, 'sortOrder 1 must sort before sortOrder 2');
  });

  await test('7b. an out-of-range or non-integer sortOrder is rejected with 400', async () => {
    for (const bad of [-1, 1.5, 'first', null, 100001]) {
      const res = await adminFetch('/api/apps/com.asc.sort.a/catalog-meta', {
        method: 'POST',
        body: JSON.stringify({ sortOrder: bad }),
      });
      assert.strictEqual(res.status, 400, `sortOrder=${JSON.stringify(bad)} must be rejected`);
    }
  });

  await test('7c. catalog-meta with no recognized field is rejected with 400 (never a silent no-op)', async () => {
    const res = await adminFetch('/api/apps/com.asc.sort.a/catalog-meta', { method: 'POST', body: JSON.stringify({}) });
    assert.strictEqual(res.status, 400);
  });

  await test('7d. catalog-meta for an unknown package returns 404', async () => {
    const res = await adminFetch('/api/apps/com.asc.does.not.exist/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ isRecommended: true }),
    });
    assert.strictEqual(res.status, 404);
  });

  // ================= 8 & 9: search/filter are admin-panel client-side behavior =================
  // Section L items 8-9 (catalog search/filter in the admin UI) are DOM/JS
  // behavior with no server endpoint of their own (see docs/
  // app-store-catalog.md - by design, per the task's own instruction not to
  // build a new device/admin search API). What IS server-owned and tested
  // here is that GET /api/apps returns enough real data (name, packageName,
  // category) for that client-side filtering to work correctly.

  await test('8/9. GET /api/apps returns name+packageName+category for every row (what the admin UI search/filter needs)', async () => {
    const res = await adminFetch('/api/apps');
    const rows = await res.json();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.strictEqual(typeof row.name, 'string');
      assert.strictEqual(typeof row.packageName, 'string');
      assert.strictEqual(typeof row.category, 'string');
    }
  });

  // ================= 10: sync includes the new fields =================

  await test('10. /sync includes category, categoryLabel, isRecommended, sortOrder, playVersion, playUpdatedAt', async () => {
    const dev = await createTestDevice('sync-fields');
    await assignApp(dev.deviceId, 'com.asc.playapp');
    const res = await sync(dev.deviceId, dev.token);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const entry = body.catalog.find(a => a.packageName === 'com.asc.playapp');
    assert.ok(entry, 'the assigned app must appear in the sync catalog');
    assert.strictEqual(entry.category, 'tools');
    assert.strictEqual(entry.categoryLabel, appCategories.categoryLabel('tools'));
    assert.strictEqual(entry.isRecommended, true);
    assert.strictEqual(typeof entry.sortOrder, 'number');
    assert.strictEqual(entry.playVersion, '1.3.0');
    assert.strictEqual(typeof entry.playUpdatedAt, 'number');
    // Original fields must still be present, unrenamed.
    assert.strictEqual(entry.name, 'Play App');
    assert.ok('iconUrl' in entry);
  });

  // ================= 11 & 12: per-device allowlist still filters correctly; no leakage =================

  await test('11/12. a device only sees apps it is actually allowed - a recommended app NOT allowed for it never leaks into its catalog', async () => {
    await db.addAppToCatalog('com.asc.recommended.notallowed', 'Not Allowed But Recommended', null);
    await adminFetch('/api/apps/com.asc.recommended.notallowed/catalog-meta', {
      method: 'POST',
      body: JSON.stringify({ isRecommended: true }),
    });
    const dev = await createTestDevice('no-leak');
    // Deliberately do NOT assign com.asc.recommended.notallowed to this device.
    await assignApp(dev.deviceId, 'com.asc.playapp');
    const res = await sync(dev.deviceId, dev.token);
    const body = await res.json();
    assert.ok(body.catalog.some(a => a.packageName === 'com.asc.playapp'), 'the actually-allowed app must be present');
    assert.ok(
      !body.catalog.some(a => a.packageName === 'com.asc.recommended.notallowed'),
      'a recommended app this device was never approved for must never appear in its sync catalog',
    );
  });

  // ================= 13: existing assign-all still works =================

  await test('13. POST /api/apps/:packageName/assign-all still assigns to every device unchanged', async () => {
    const devA = await createTestDevice('assign-all-a');
    const devB = await createTestDevice('assign-all-b');
    const res = await adminFetch('/api/apps/com.asc.sort.a/assign-all', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.updated >= 2);
    for (const dev of [devA, devB]) {
      const syncRes = await sync(dev.deviceId, dev.token);
      const syncBody = await syncRes.json();
      assert.ok(syncBody.catalog.some(a => a.packageName === 'com.asc.sort.a'));
    }
  });

  // ================= 14: existing per-device assignment still works =================

  await test('14. POST /api/devices/:deviceId/policy/apps still assigns to exactly one device', async () => {
    const dev = await createTestDevice('per-device-assign');
    const other = await createTestDevice('per-device-other');
    await assignApp(dev.deviceId, 'com.asc.sort.b');
    const [res1, res2] = await Promise.all([sync(dev.deviceId, dev.token), sync(other.deviceId, other.token)]);
    const [body1, body2] = await Promise.all([res1.json(), res2.json()]);
    assert.ok(body1.catalog.some(a => a.packageName === 'com.asc.sort.b'));
    assert.ok(!body2.catalog.some(a => a.packageName === 'com.asc.sort.b'), 'assigning to one device must not leak to another');
  });

  // ================= 15: existing Play metadata refresh still works =================

  await test('15. POST /api/apps/refresh-play-metadata still runs and returns the expected shape (network unavailable here -> failures, never a crash or a fabricated category)', async () => {
    // This sandbox cannot reach play.google.com (verified: proxy denies the
    // CONNECT) so every candidate is expected to fail the real fetch - the
    // important thing is the endpoint itself still behaves exactly as
    // before: it runs, accounts for every candidate, records a failure
    // (never silently drops a package), and never invents a category out
    // of a failed fetch.
    const before = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    const res = await adminFetch('/api/apps/refresh-play-metadata', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(typeof body.processed, 'number');
    assert.strictEqual(typeof body.remaining, 'number');
    assert.ok(Array.isArray(body.results));
    const after = (await db.listAppsCatalog()).find(a => a.packageName === 'com.asc.legacy1');
    assert.strictEqual(after.categorySource, before.categorySource, 'a failed refresh must never change an existing category/source');
    assert.strictEqual(after.category, before.category);
  });

  // ================= summary =================

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
