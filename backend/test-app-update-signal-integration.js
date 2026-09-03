// REAL PostgreSQL + real HTTP integration suite for the app-update-check
// backend support (branch app-update-check). Covers the 5 scenarios the
// task asked for: fresh metadata, stale metadata, a Play lookup failure,
// rollout/version-mismatch uncertainty, and a backward-compatible sync
// response - plus a real end-to-end check that Play metadata refreshes
// automatically (no manual admin action) on a device sync.
//
// Nothing here is mocked: real local Postgres, a real running
// backend/index.js over real HTTP. Google Play itself is not reachable
// from this sandbox (see docs/app-update-check.md / docs/app-store-
// catalog.md for the verified network-policy blocker) - these tests write
// the DB rows a real Play fetch (success, failure, or an ambiguous-version
// response) would have produced, and check the exact same read path
// (db.listAppsCatalog / GET /api/apps / POST .../sync) a real fetch's
// result would flow through.
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
//     export PORT=4351 TEST_BASE_URL=http://127.0.0.1:4351
//     node index.js > /tmp/server-update-signal.log 2>&1 &
//     SERVER_PID=$!
//     node test-app-update-signal-integration.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4351';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const freshness = require('./playMetadataFreshness');
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

async function createTestDevice(label) {
  const deviceId = `aus-${label}-${crypto.randomUUID()}`;
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

// Directly stamps play_metadata_checked_at/play_metadata_error - simulates
// exactly what a real Play fetch's outcome (success, failure, or an
// ambiguous version) would have left behind, without needing real network
// access to Google Play (blocked in this sandbox - see the header comment).
async function stampMetadataCheck(packageName, { checkedAt, error = null }) {
  await rawPool.query(
    `UPDATE apps_catalog SET play_metadata_checked_at = $2, play_metadata_error = $3 WHERE package_name = $1`,
    [packageName, checkedAt, error],
  );
}

async function resetTestDatabase() {
  await rawPool.query(`TRUNCATE apps_catalog, commands, alerts, enrollments, devices RESTART IDENTITY CASCADE`);
}

(async () => {
  await waitForServer();
  await db.init();
  await resetTestDatabase();
  await adminLogin();

  // ================= 1: fresh metadata =================

  await test('1. fresh metadata: recently-checked real version reports playMetadataFreshness "fresh" via GET /api/apps and /sync', async () => {
    await db.addAppToCatalog('com.aus.fresh', 'Fresh App', null, '3.0.0', Date.now());
    await stampMetadataCheck('com.aus.fresh', { checkedAt: Date.now() - 60_000 });

    const adminRow = (await (await adminFetch('/api/apps')).json()).find(a => a.packageName === 'com.aus.fresh');
    assert.strictEqual(adminRow.playMetadataFreshness, 'fresh');
    assert.strictEqual(typeof adminRow.playMetadataCheckedAt, 'number');
    assert.strictEqual(adminRow.playMetadataError, null);

    const dev = await createTestDevice('fresh');
    await assignApp(dev.deviceId, 'com.aus.fresh');
    const syncBody = await (await sync(dev.deviceId, dev.token)).json();
    const entry = syncBody.catalog.find(a => a.packageName === 'com.aus.fresh');
    assert.strictEqual(entry.playMetadataFreshness, 'fresh');
    assert.strictEqual(typeof entry.playMetadataCheckedAt, 'number');
    assert.strictEqual('playMetadataError' in entry, false, 'the raw scraper error string must never reach a device');
  });

  // ================= 2: stale metadata =================

  await test('2. stale metadata: checked long ago with no error reports "stale"', async () => {
    await db.addAppToCatalog('com.aus.stale', 'Stale App', null, '1.2', Date.now());
    await stampMetadataCheck('com.aus.stale', { checkedAt: Date.now() - freshness.PLAY_METADATA_FRESH_MS * 10 });

    const adminRow = (await (await adminFetch('/api/apps')).json()).find(a => a.packageName === 'com.aus.stale');
    assert.strictEqual(adminRow.playMetadataFreshness, 'stale');

    const dev = await createTestDevice('stale');
    await assignApp(dev.deviceId, 'com.aus.stale');
    const syncBody = await (await sync(dev.deviceId, dev.token)).json();
    assert.strictEqual(syncBody.catalog.find(a => a.packageName === 'com.aus.stale').playMetadataFreshness, 'stale');
  });

  // ================= 3: Play lookup failure =================

  await test('3. Play lookup failure: a recorded error reports "stale" to the admin (with the reason) and to devices (without leaking it)', async () => {
    await db.addAppToCatalog('com.aus.failed', 'Failed Lookup App', null, '1.0', Date.now());
    await stampMetadataCheck('com.aus.failed', { checkedAt: Date.now() - 1000, error: 'Google Play HTTP 503' });

    const adminRow = (await (await adminFetch('/api/apps')).json()).find(a => a.packageName === 'com.aus.failed');
    assert.strictEqual(adminRow.playMetadataFreshness, 'stale');
    assert.strictEqual(adminRow.playMetadataError, 'Google Play HTTP 503');

    const dev = await createTestDevice('failed');
    await assignApp(dev.deviceId, 'com.aus.failed');
    const syncBody = await (await sync(dev.deviceId, dev.token)).json();
    const entry = syncBody.catalog.find(a => a.packageName === 'com.aus.failed');
    assert.strictEqual(entry.playMetadataFreshness, 'stale');
    assert.strictEqual('playMetadataError' in entry, false);
  });

  // ================= 4: rollout/version-mismatch uncertainty =================

  await test('4. rollout/version-mismatch uncertainty: Play\'s own "Varies with device" version reports "unknown", never a fabricated update signal', async () => {
    await db.addAppToCatalog('com.aus.varies', 'Multi-APK App', null, 'Varies with device', Date.now());
    await stampMetadataCheck('com.aus.varies', { checkedAt: Date.now() - 1000 });

    const adminRow = (await (await adminFetch('/api/apps')).json()).find(a => a.packageName === 'com.aus.varies');
    assert.strictEqual(adminRow.playMetadataFreshness, 'unknown', 'an ambiguous version must never be graded fresh, even when just checked');

    const dev = await createTestDevice('varies');
    await assignApp(dev.deviceId, 'com.aus.varies');
    const syncBody = await (await sync(dev.deviceId, dev.token)).json();
    assert.strictEqual(syncBody.catalog.find(a => a.packageName === 'com.aus.varies').playMetadataFreshness, 'unknown');
  });

  // ================= 5: backward-compatible sync response =================

  await test('5. backward-compatible sync: every pre-existing field is present, unrenamed, and correctly typed alongside the new ones', async () => {
    await db.addAppToCatalog('com.aus.legacy', 'Legacy Row', 'https://example.com/icon.png', '4.4', Date.now());
    // No stampMetadataCheck call at all here - simulates a genuinely
    // pre-migration row that has never gone through a Play refresh.
    const dev = await createTestDevice('legacy');
    await assignApp(dev.deviceId, 'com.aus.legacy');
    const syncBody = await (await sync(dev.deviceId, dev.token)).json();
    const entry = syncBody.catalog.find(a => a.packageName === 'com.aus.legacy');

    // Original fields (pre-dating both the categories work and this
    // feature) - unrenamed, unremoved, correct type.
    assert.strictEqual(entry.packageName, 'com.aus.legacy');
    assert.strictEqual(entry.name, 'Legacy Row');
    assert.strictEqual(entry.iconUrl, 'https://example.com/icon.png');
    assert.strictEqual(entry.playVersion, '4.4');
    assert.strictEqual(typeof entry.playUpdatedAt, 'number');
    // Categories-phase fields, still present.
    assert.strictEqual(entry.category, 'other');
    assert.strictEqual(typeof entry.categoryLabel, 'string');
    assert.strictEqual(entry.isRecommended, false);
    assert.strictEqual(typeof entry.sortOrder, 'number');
    // This phase's new fields - additive, never breaking a row with no
    // check history at all.
    assert.strictEqual(entry.playMetadataCheckedAt, null);
    assert.strictEqual(entry.playMetadataFreshness, 'unknown');
    assert.strictEqual('playMetadataError' in entry, false);
  });

  await test('5b. GET /api/apps (admin) also stays backward-compatible - all fields present on a fully-populated row', async () => {
    const row = (await (await adminFetch('/api/apps')).json()).find(a => a.packageName === 'com.aus.fresh');
    for (const key of [
      'packageName', 'name', 'iconUrl', 'playVersion', 'playUpdatedAt', 'addedAt',
      'category', 'categorySource', 'isRecommended', 'sortOrder',
      'playMetadataCheckedAt', 'playMetadataFreshness', 'playMetadataError',
    ]) {
      assert.ok(key in row, `missing field: ${key}`);
    }
  });

  // ================= 6: automatic refresh, no manual admin action =================

  await test('6. Play metadata refresh is kicked automatically by a device sync - no admin click required', async () => {
    // A never-checked package, exactly the kind claimAppsForPlayMetadataRefresh
    // picks up first (NULLS FIRST ordering).
    await db.addAppToCatalog('com.aus.neverchecked', 'Never Checked App', null);
    const before = (await db.listAppsCatalog()).find(a => a.packageName === 'com.aus.neverchecked');
    assert.strictEqual(before.playMetadataCheckedAt, null);

    const dev = await createTestDevice('auto-refresh');
    await assignApp(dev.deviceId, 'com.aus.neverchecked');
    await sync(dev.deviceId, dev.token); // kicks the background refresh (fire-and-forget)

    // The refresh runs in the background (setImmediate) and, in this
    // sandbox, will fail fast (Google Play is unreachable - see the header
    // comment) - but "attempted and recorded a failure" is exactly the
    // observable proof that an automatic attempt happened with zero admin
    // action, which is what this test is actually proving.
    //
    // AUTO_PLAY_REFRESH_MIN_KICK_MS (60s, index.js) is a GLOBAL per-process
    // throttle, not per-package - this fixture server's own startup kick
    // (fired the instant it booted, against whatever this shared appstore_test
    // database already had in it) already consumed the first kick slot,
    // so this sync's kick attempt is legitimately a no-op until that
    // window clears. Waiting it out for real (rather than mocking the
    // clock) is what actually proves the end-to-end wiring - see
    // docs/app-update-check.md for why this window exists at all
    // (protecting Google Play from a fleet-wide sync burst).
    let after = null;
    const deadline = Date.now() + 75000;
    while (Date.now() < deadline) {
      after = (await db.listAppsCatalog()).find(a => a.packageName === 'com.aus.neverchecked');
      if (after.playMetadataCheckedAt != null) break;
      await sync(dev.deviceId, dev.token); // keep re-kicking until the 60s throttle clears
      await new Promise(r => setTimeout(r, 3000));
    }
    assert.ok(after && after.playMetadataCheckedAt != null, 'a device sync must trigger an automatic Play metadata check attempt with no admin action');
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
