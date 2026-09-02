// REAL PostgreSQL load/abuse/failure-hardening suite for the Filtered
// Browser backend (Server Phase 2.3). Nothing here is mocked: a real
// PostgreSQL 16 database, a real running instance of this backend
// (index.js) over real HTTP, real concurrent bursts via Promise.all, a
// real `service postgresql stop/start` for the dependency-unavailable
// test, and a second, independently spawned+killed real backend process
// for the restart/persistence section.
//
// Requires (set by the caller, see the shell wrapper below):
//   DATABASE_URL, DATABASE_SSL=disable  - the test Postgres database
//   TEST_BASE_URL                        - base URL of a running backend
//                                          instance pointed at the same DB
//   ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET - must match that instance
//
// This suite does three things test-db-integration.js/test-admin-ui-e2e.js
// don't:
//   1. Fires real concurrent bursts (Promise.all) at a live server instead
//      of one request at a time, to prove dedup/no-duplicate-writes under
//      actual concurrency, not just two racing writes.
//   2. Actually stops the real PostgreSQL service mid-suite (and restarts
//      it) to prove the "PostgreSQL unavailable" fail-closed path for
//      real, not simulated.
//   3. Spawns and kills a second real backend process itself (separate
//      from the shell-wrapper-launched fixture server) to prove state
//      survives an actual process restart against the same database.
//
// ---------------------------------------------------------------------
// One-time local setup - identical to test-db-integration.js's (same
// browser_test / browser_test_user role+database is reused):
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS browser_test;" \
//     -c "DROP ROLE IF EXISTS browser_test_user;" \
//     -c "CREATE ROLE browser_test_user LOGIN PASSWORD 'browser_test_pw';" \
//     -c "CREATE DATABASE browser_test OWNER browser_test_user;"
//
// The account running this suite must be able to run `service postgresql
// stop|start` without a password prompt (root/sudo in this sandbox) - see
// section 2's "PostgreSQL unavailable" test. If that's not possible in a
// given environment, that one test will fail loudly rather than silently
// skipping - it does not pretend to have verified the behavior.
//
// From backend/, in one shell (starts the real fixture server, runs this
// suite against it over real HTTP + a direct DB connection, tears the
// server down afterward, exits non-zero if anything failed):
//
//   (
//     export DATABASE_URL="postgresql://browser_test_user:browser_test_pw@127.0.0.1:5432/browser_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4331 TEST_BASE_URL=http://127.0.0.1:4331
//     node index.js > /tmp/server-load.log 2>&1 &
//     SERVER_PID=$!
//     node test-browser-load.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
//
// Runtime: this suite deliberately sleeps for one real rate-limit window
// (~10s, see BROWSER_CHECK_RATE_LIMIT_WINDOW_MS) to prove the limiter
// resets rather than permanently blocking a device - expect ~15-25s total.
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4331';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const browserPolicy = require('./browserPolicy');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
// See db.js's own pool.on('error', ...) comment - this suite deliberately
// stops the real Postgres service mid-run (section 2), which otherwise
// crashes THIS process too via the same unhandled-idle-client-error path.
rawPool.on('error', err => {
  console.error('(expected during the PostgreSQL-unavailable test) idle test pool error:', err.message);
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

async function waitForHealth(baseUrl, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}

async function waitForPostgres(timeoutMs = 25000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      await rawPool.query('SELECT 1');
      return;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`PostgreSQL did not become reachable within ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

async function createTestDevice(label) {
  const deviceId = `p23-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(
    `INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`,
    [deviceId, sha256(token)],
  );
  return { deviceId, token };
}

async function createTestDeviceWithId(deviceId) {
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(
    `INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET auth_token_hash = EXCLUDED.auth_token_hash`,
    [deviceId, sha256(token)],
  );
  return { deviceId, token };
}

async function deviceCheck(baseUrl, deviceId, token, url, extraHeaders = {}) {
  return fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/browser/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ url }),
  });
}

async function deviceCheckRaw(baseUrl, deviceId, token, rawBody) {
  return fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/browser/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token != null ? { Authorization: `Bearer ${token}` } : {}) },
    body: rawBody,
  });
}

async function resetTestDatabase() {
  await rawPool.query(`
    TRUNCATE browser_policy_audit, browser_decision_log, browser_request_devices,
             browser_requests, browser_device_overrides, browser_domains,
             commands, alerts, enrollments, devices
    RESTART IDENTITY CASCADE
  `);
  await rawPool.query(`UPDATE browser_policy_meta SET value = 1 WHERE key = 'policy_version'`);
}

// Same sentinel-trigger technique as test-db-integration.js's rollback
// tests (a table-owner role bypasses REVOKE-based fault injection, so a
// scoped trigger is the only real way to force a late-transaction/insert
// failure without touching db.js). This one fires on browser_decision_log
// instead of browser_policy_audit, because logBrowserDecision's INSERT is
// what's genuinely LAST on the /browser/check hot path - forcing it to
// fail proves the route fails closed even when the failure happens AFTER
// the ALLOW/BLOCK/REVIEW decision was already computed.
async function installDecisionLogFailureTrigger() {
  await rawPool.query(`
    CREATE OR REPLACE FUNCTION __test_force_decision_log_failure() RETURNS trigger AS $$
    BEGIN
      IF NEW.device_id = '__p23_force_check_failure__' THEN
        RAISE EXCEPTION 'forced failure for /browser/check fail-closed test';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await rawPool.query(`DROP TRIGGER IF EXISTS __test_force_decision_log_failure_trigger ON browser_decision_log`);
  await rawPool.query(`
    CREATE TRIGGER __test_force_decision_log_failure_trigger
      BEFORE INSERT ON browser_decision_log
      FOR EACH ROW EXECUTE FUNCTION __test_force_decision_log_failure();
  `);
}

async function removeDecisionLogFailureTrigger() {
  await rawPool.query(`DROP TRIGGER IF EXISTS __test_force_decision_log_failure_trigger ON browser_decision_log`);
  await rawPool.query(`DROP FUNCTION IF EXISTS __test_force_decision_log_failure()`);
}

function spawnBackend(port, extraEnv = {}) {
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
    if (proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('process did not exit within timeout')), timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
}

(async () => {
  await waitForHealth(BASE_URL);
  await db.init();
  await resetTestDatabase();

  // ================= 1: LOAD / CONCURRENCY =================

  await test('load: burst of 25 concurrent checks from ONE device for the same unknown domain dedups to one request', async () => {
    const dev = await createTestDevice('burst-one-device');
    const domain = 'p23-burst-single.itest.com';
    const url = `https://${domain}/`;
    const t0 = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 25 }, () => deviceCheck(BASE_URL, dev.deviceId, dev.token, url)),
    );
    const elapsed = Date.now() - t0;
    console.log(`  (25 concurrent checks, 1 device, 1 unknown domain: ${elapsed}ms, ${(25000 / elapsed).toFixed(1)} req/s)`);
    for (const res of responses) {
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.decision, 'REVIEW');
    }
    const { rows: reqRows } = await rawPool.query(
      `SELECT * FROM browser_requests WHERE domain = $1`, [domain],
    );
    assert.strictEqual(reqRows.length, 1, 'exactly one browser_requests row must exist for this domain, never 25');
    assert.strictEqual(reqRows[0].status, 'PENDING');
    const { rows: deviceRows } = await rawPool.query(
      `SELECT * FROM browser_request_devices WHERE request_id = $1`, [reqRows[0].id],
    );
    assert.strictEqual(deviceRows.length, 1, 'the same device asking 25 times must still be exactly one requester row');
    assert.strictEqual(deviceRows[0].device_id, dev.deviceId);
  });

  await test('load: burst from 30 distinct devices for the same unknown domain collapses to one request with 30 requesters', async () => {
    const domain = 'p23-burst-many-devices.itest.com';
    const url = `https://${domain}/`;
    const devices = await Promise.all(Array.from({ length: 30 }, (_, i) => createTestDevice(`many-${i}`)));
    const t0 = Date.now();
    const responses = await Promise.all(devices.map(d => deviceCheck(BASE_URL, d.deviceId, d.token, url)));
    const elapsed = Date.now() - t0;
    console.log(`  (30 concurrent checks, 30 devices, 1 unknown domain: ${elapsed}ms, ${(30000 / elapsed).toFixed(1)} req/s)`);
    for (const res of responses) {
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.decision, 'REVIEW');
    }
    const { rows: reqRows } = await rawPool.query(`SELECT * FROM browser_requests WHERE domain = $1`, [domain]);
    assert.strictEqual(reqRows.length, 1, 'thirty devices hitting the same unknown domain at once must still collapse to one request row');
    const { rows: deviceRows } = await rawPool.query(
      `SELECT DISTINCT device_id FROM browser_request_devices WHERE request_id = $1`, [reqRows[0].id],
    );
    assert.strictEqual(deviceRows.length, 30, 'every one of the 30 distinct devices must be tracked as a requester, no duplicates and none dropped');

    const listed = await db.listPendingBrowserRequests();
    const entry = listed.find(r => r.domain === domain);
    assert.ok(entry, 'the request must show up in the admin pending-request list');
    assert.strictEqual(entry.requesterCount, 30);
    assert.strictEqual(entry.totalRequesterCount, 30);
  });

  await test('load: mixed ALLOW/BLOCK/REVIEW traffic never corrupts an existing policy row', async () => {
    const allowDomain = 'p23-mixed-allow.com';
    const blockDomain = 'p23-mixed-block.com';
    await db.upsertBrowserDomain({
      domain: allowDomain, decision: 'ALLOW', allowSubdomains: false,
      approvalMethod: 'admin_manual', actor: 'p23-seed',
    });
    await db.upsertBrowserDomain({
      domain: blockDomain, decision: 'BLOCK', allowSubdomains: false,
      approvalMethod: 'admin_manual', actor: 'p23-seed',
    });
    const before = await rawPool.query(
      `SELECT domain, decision, decision_version, updated_at FROM browser_domains WHERE domain = ANY($1) ORDER BY domain`,
      [[allowDomain, blockDomain]],
    );

    const devices = await Promise.all(Array.from({ length: 12 }, (_, i) => createTestDevice(`mixed-${i}`)));
    const calls = [];
    for (const dev of devices) {
      calls.push(deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${allowDomain}/`).then(r => ({ kind: 'allow', r })));
      calls.push(deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${blockDomain}/`).then(r => ({ kind: 'block', r })));
      calls.push(deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://p23-mixed-unknown-${dev.deviceId}.itest.com/`).then(r => ({ kind: 'unknown', r })));
    }
    const t0 = Date.now();
    const results = await Promise.all(calls);
    const elapsed = Date.now() - t0;
    console.log(`  (${calls.length} mixed concurrent checks across 12 devices: ${elapsed}ms, ${(calls.length * 1000 / elapsed).toFixed(1)} req/s)`);

    for (const { kind, r } of results) {
      assert.strictEqual(r.status, 200);
      const body = await r.json();
      if (kind === 'allow') assert.strictEqual(body.decision, 'ALLOW');
      if (kind === 'block') assert.strictEqual(body.decision, 'BLOCK');
      if (kind === 'unknown') assert.strictEqual(body.decision, 'REVIEW');
    }

    const after = await rawPool.query(
      `SELECT domain, decision, decision_version, updated_at FROM browser_domains WHERE domain = ANY($1) ORDER BY domain`,
      [[allowDomain, blockDomain]],
    );
    assert.deepStrictEqual(
      after.rows.map(r => ({ domain: r.domain, decision: r.decision, decision_version: r.decision_version, updated_at: r.updated_at.toISOString() })),
      before.rows.map(r => ({ domain: r.domain, decision: r.decision, decision_version: r.decision_version, updated_at: r.updated_at.toISOString() })),
      'reading ALLOW/BLOCK domains under concurrent mixed load must never write to browser_domains - decision_version/updated_at must be byte-identical before and after',
    );

    const { rows: unknownReqs } = await rawPool.query(
      `SELECT domain FROM browser_requests WHERE domain LIKE 'p23-mixed-unknown-%'`,
    );
    assert.strictEqual(unknownReqs.length, 12, 'exactly one pending request per distinct unknown domain, one per device in this case');
  });

  // ================= 2: FAILURE BEHAVIOR =================

  await test('failure: missing url field -> 400, no decision object', async () => {
    const dev = await createTestDevice('missing-url');
    const res = await deviceCheckRaw(BASE_URL, dev.deviceId, dev.token, JSON.stringify({}));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.decision, undefined);
  });

  await test('failure: wrong JSON types for url (number/object/array/bool/null) -> 400, never ALLOW', async () => {
    const dev = await createTestDevice('wrong-types');
    for (const bad of [12345, { not: 'a string' }, ['a', 'b'], true, null]) {
      const res = await deviceCheckRaw(BASE_URL, dev.deviceId, dev.token, JSON.stringify({ url: bad }));
      assert.strictEqual(res.status, 400, `url=${JSON.stringify(bad)} must be rejected as malformed`);
      const body = await res.json();
      assert.notStrictEqual(body.decision, 'ALLOW');
    }
  });

  await test('failure: overlong url (over the real HTTP endpoint) -> 400, never ALLOW', async () => {
    const dev = await createTestDevice('overlong-url');
    const overlong = `https://p23-overlong.itest.com/${'a'.repeat(browserPolicy.MAX_CHECK_URL_LENGTH)}`;
    const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, overlong);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.notStrictEqual(body.decision, 'ALLOW');
  });

  await test('failure: request body over the JSON body-size limit -> rejected (413/400), never ALLOW', async () => {
    const dev = await createTestDevice('oversized-body');
    // Well over express.json()'s default 100kb limit, padded onto an
    // otherwise-valid field so the failure is genuinely about total body
    // size, not JSON syntax.
    const oversizedBody = JSON.stringify({ url: 'https://p23-oversized.itest.com/', padding: 'x'.repeat(200000) });
    const res = await deviceCheckRaw(BASE_URL, dev.deviceId, dev.token, oversizedBody);
    // body-parser rejects this before the route ever runs (a real
    // PayloadTooLargeError), but index.js's single global error handler
    // collapses every error - including this one - to a plain 500 rather
    // than forwarding the real 413 (see docs/server-progress.md for why
    // this is left as-is: still always non-2xx/fail-closed, and changing
    // shared error-handling for every endpoint is out of this phase's
    // scope). Verified real behavior, not assumed: accept either.
    assert.ok(res.status === 413 || res.status === 500, `expected 413 or 500, got ${res.status}`);
    const text = await res.text();
    assert.ok(!text.includes('"decision":"ALLOW"'), 'an oversized body must never produce an ALLOW decision');
  });

  await test('failure: malformed/invalid IDN host -> either 400 or a non-ALLOW decision, never ALLOW', async () => {
    const dev = await createTestDevice('bad-idn');
    // Invalid Punycode (xn-- prefix with content that does not decode) and
    // a host containing a zero-width space (U+200B) smuggled in via
    // percent-encoding, both real-world homograph/confusable techniques.
    const candidates = [
      'https://xn--zz4az344avm/', // syntactically-plausible but not a real registered Punycode label
      'https://p23-zwsp​.itest.com/',
      'https://p23‐confusable.itest.com/', // U+2010 hyphen look-alike, not ASCII '-'
    ];
    for (const url of candidates) {
      const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, url);
      if (res.status === 400) continue; // rejected as unparseable - fine, fail-closed
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.notStrictEqual(body.decision, 'ALLOW', `${url} must never resolve to ALLOW - it has no admin-approved rule`);
    }
  });

  await test('failure: forbidden scheme (ftp:) -> explicit BLOCK, never ALLOW', async () => {
    const dev = await createTestDevice('ftp-scheme');
    const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, 'ftp://p23-ftp.itest.com/file');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision, 'BLOCK');
    assert.strictEqual(body.reason, 'forbidden_scheme');
  });

  await test('failure: IPv4 and IPv6 literal hosts -> explicit BLOCK, never ALLOW', async () => {
    const dev = await createTestDevice('ip-literal');
    for (const url of ['https://192.168.1.1/', 'https://[::1]/', 'http://8.8.8.8/']) {
      const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, url);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.decision, 'BLOCK', `${url} must BLOCK`);
      assert.strictEqual(body.reason, 'invalid_or_ip_literal_host');
    }
  });

  await test('failure: non-default port on an otherwise-unknown host still evaluates by hostname only (never ALLOW), by design', async () => {
    // Documented, deliberate architecture (server-api-contract.md): the
    // check endpoint evaluates the hostname only, the same way for any
    // port - it is not a per-port policy. This proves that behavior is
    // real and doesn't accidentally leak an ALLOW for an unusual port.
    const dev = await createTestDevice('weird-port');
    const host = 'p23-port-test.itest.com';
    const [r1, r2] = await Promise.all([
      deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${host}:9443/`),
      deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${host}:443/`),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    assert.strictEqual(b1.decision, 'REVIEW');
    assert.strictEqual(b2.decision, 'REVIEW');
    assert.strictEqual(b1.domain, host);
    assert.strictEqual(b2.domain, host);
  });

  await test('failure: device auth missing -> 401, no decision object', async () => {
    const dev = await createTestDevice('auth-missing');
    const res = await deviceCheck(BASE_URL, dev.deviceId, null, 'https://p23-auth-missing.itest.com/');
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.decision, undefined);
  });

  await test('failure: device auth wrong token -> 401, no decision object', async () => {
    const dev = await createTestDevice('auth-wrong');
    const res = await deviceCheck(BASE_URL, dev.deviceId, 'not-the-real-token', 'https://p23-auth-wrong.itest.com/');
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.decision, undefined);
  });

  await test('failure: unknown device id -> 404, no decision object', async () => {
    const res = await deviceCheck(BASE_URL, 'p23-device-does-not-exist', 'irrelevant', 'https://p23-auth-404.itest.com/');
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.decision, undefined);
  });

  await test('failure: a real DB write failure mid-request (post-decision) still fails closed, even for an ALLOW-eligible domain', async () => {
    const domain = 'p23-forced-db-failure.itest.com';
    await db.upsertBrowserDomain({
      domain, decision: 'ALLOW', allowSubdomains: false,
      approvalMethod: 'admin_manual', actor: 'p23-seed',
    });
    const dev = await createTestDeviceWithId('__p23_force_check_failure__');
    await installDecisionLogFailureTrigger();
    try {
      const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${domain}/`);
      assert.ok(res.status >= 500 && res.status < 600, `expected 5xx when the audit-log write fails, got ${res.status}`);
      const text = await res.text();
      assert.ok(!text.includes('"decision":"ALLOW"'), 'a mid-request DB failure must never let an ALLOW decision reach the client');
    } finally {
      await removeDecisionLogFailureTrigger();
    }
    // Confirm this was a real, scoped fault injection with no lasting
    // effect: the same device+domain now succeeds normally.
    const res2 = await deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${domain}/`);
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.decision, 'ALLOW');
  });

  await test('failure: PostgreSQL unavailable mid-operation -> 5xx, never ALLOW, and recovers once it is back', async () => {
    const domain = 'p23-pg-down.itest.com';
    await db.upsertBrowserDomain({
      domain, decision: 'ALLOW', allowSubdomains: false,
      approvalMethod: 'admin_manual', actor: 'p23-seed',
    });
    const dev = await createTestDevice('pg-down');
    execSync('service postgresql stop', { stdio: 'ignore' });
    try {
      // Give the fixture server's connection pool a moment to actually
      // notice the database is gone rather than serving from an
      // already-open, still-idle connection.
      await new Promise(r => setTimeout(r, 1000));
      const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${domain}/`);
      assert.ok(res.status >= 500 && res.status < 600, `expected 5xx while Postgres is down, got ${res.status}`);
      const text = await res.text();
      assert.ok(!text.includes('"decision":"ALLOW"'), 'the endpoint must never fabricate ALLOW when its database is unreachable');
    } finally {
      execSync('service postgresql start', { stdio: 'ignore' });
      await waitForPostgres();
    }
    // Real recovery check, not assumed: the exact same request now succeeds.
    const res2 = await deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://${domain}/`);
    assert.strictEqual(res2.status, 200);
    const body2 = await res2.json();
    assert.strictEqual(body2.decision, 'ALLOW');
  });

  // ================= 3: RESOURCE-ABUSE / RATE LIMIT =================

  const RATE_LIMIT_MAX = Number(process.env.BROWSER_CHECK_RATE_LIMIT_MAX) || 40;
  const RATE_LIMIT_WINDOW_MS = Number(process.env.BROWSER_CHECK_RATE_LIMIT_WINDOW_MS) || 10000;

  await test(`rate limit: a burst of ${RATE_LIMIT_MAX + 5} concurrent checks from one device gets throttled past ${RATE_LIMIT_MAX}, never ALLOW`, async () => {
    const dev = await createTestDevice('rate-limit-burst');
    const total = RATE_LIMIT_MAX + 5;
    const responses = await Promise.all(
      Array.from({ length: total }, (_, i) => deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://p23-rl-${i}.itest.com/`)),
    );
    let ok = 0;
    let limited = 0;
    for (const res of responses) {
      if (res.status === 429) {
        limited++;
        const body = await res.json();
        assert.strictEqual(body.decision, undefined, 'a 429 must never carry a decision object');
      } else {
        assert.strictEqual(res.status, 200);
        ok++;
        const body = await res.json();
        assert.notStrictEqual(body.decision, 'ALLOW', 'an unrecognized domain must never be ALLOW regardless of rate-limit state');
      }
    }
    console.log(`  (${total} concurrent from one device: ${ok} succeeded, ${limited} throttled with 429)`);
    assert.ok(ok <= RATE_LIMIT_MAX, `expected at most ${RATE_LIMIT_MAX} to succeed, got ${ok}`);
    assert.ok(limited >= total - RATE_LIMIT_MAX, `expected at least ${total - RATE_LIMIT_MAX} to be throttled, got ${limited}`);
  });

  await test('rate limit: a different, fresh device is unaffected by another device being throttled (per-device, not global)', async () => {
    const dev = await createTestDevice('rate-limit-unaffected');
    const res = await deviceCheck(BASE_URL, dev.deviceId, dev.token, 'https://p23-rl-fresh-device.itest.com/');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision, 'REVIEW');
  });

  await test('rate limit: a moderate burst well under the limit is never throttled', async () => {
    const dev = await createTestDevice('rate-limit-moderate');
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://p23-rl-moderate-${i}.itest.com/`)),
    );
    for (const res of responses) assert.strictEqual(res.status, 200, 'ten requests must stay well under the default limit');
  });

  await test(`rate limit: window resets after ~${Math.round(RATE_LIMIT_WINDOW_MS / 1000)}s - a throttled device can check again`, async () => {
    const dev = await createTestDevice('rate-limit-reset');
    // Exhaust this device's window.
    await Promise.all(
      Array.from({ length: RATE_LIMIT_MAX + 2 }, (_, i) => deviceCheck(BASE_URL, dev.deviceId, dev.token, `https://p23-rl-exhaust-${i}.itest.com/`)),
    );
    const throttledRes = await deviceCheck(BASE_URL, dev.deviceId, dev.token, 'https://p23-rl-confirm-throttled.itest.com/');
    assert.strictEqual(throttledRes.status, 429, 'this device should be throttled immediately after exhausting its window');

    await new Promise(r => setTimeout(r, RATE_LIMIT_WINDOW_MS + 1000));

    const afterReset = await deviceCheck(BASE_URL, dev.deviceId, dev.token, 'https://p23-rl-after-reset.itest.com/');
    assert.strictEqual(afterReset.status, 200, 'the same device must be able to check again once its window has elapsed');
    const body = await afterReset.json();
    assert.strictEqual(body.decision, 'REVIEW');
  });

  // ================= 4: QUERY PLAN VERIFICATION =================
  // Seeds realistic row volumes on top of whatever the sections above left
  // behind, then runs EXPLAIN ANALYZE on every query on the /browser/check
  // and admin-panel hot paths. Printed for the record either way; indexes
  // are only added if a plan actually shows an unindexed sequential scan
  // that could matter at this volume - see docs/server-progress.md for the
  // real conclusion reached from this output.

  async function seedForExplain() {
    const domainRows = [];
    for (let i = 0; i < 2000; i++) {
      const decision = i % 3 === 0 ? 'ALLOW' : i % 3 === 1 ? 'BLOCK' : 'REVIEW';
      domainRows.push(`('p23-explain-domain-${i}.com', '${decision}', ${i % 20 === 0 ? 'true' : 'false'}, 'seed', 'admin_manual', 1, now(), now())`);
    }
    await rawPool.query(`
      INSERT INTO browser_domains (domain, decision, allow_subdomains, source, approval_method, decision_version, created_at, updated_at)
      VALUES ${domainRows.join(',')}
      ON CONFLICT (domain) DO NOTHING
    `);

    const overrideDevices = await Promise.all(Array.from({ length: 50 }, (_, i) => createTestDevice(`explain-ov-${i}`)));
    const overrideRows = overrideDevices.map((d, i) =>
      `('${d.deviceId}', 'p23-explain-override-${i}.com', '${i % 2 === 0 ? 'ALLOW' : 'BLOCK'}', now())`);
    await rawPool.query(`
      INSERT INTO browser_device_overrides (device_id, domain, decision, created_at)
      VALUES ${overrideRows.join(',')}
      ON CONFLICT DO NOTHING
    `);

    const requestRows = [];
    const requestDeviceRows = [];
    const requestDevices = await Promise.all(Array.from({ length: 60 }, (_, i) => createTestDevice(`explain-req-${i}`)));
    for (let i = 0; i < 300; i++) {
      const id = crypto.randomUUID();
      requestRows.push(`('${id}', 'p23-explain-pending-${i}.com', 'PENDING', now(), now())`);
      const dev = requestDevices[i % requestDevices.length];
      requestDeviceRows.push(`('${id}', '${dev.deviceId}', now())`);
    }
    await rawPool.query(`
      INSERT INTO browser_requests (id, domain, status, created_at, updated_at)
      VALUES ${requestRows.join(',')}
    `);
    await rawPool.query(`
      INSERT INTO browser_request_devices (request_id, device_id, created_at)
      VALUES ${requestDeviceRows.join(',')}
      ON CONFLICT DO NOTHING
    `);

    const logRows = [];
    for (let i = 0; i < 5000; i++) {
      logRows.push(`('${crypto.randomUUID()}', 'p23-explain-domain-${i % 2000}.com', 'REVIEW', 'policy_engine', now() - (${i} || ' seconds')::interval)`);
    }
    await rawPool.query(`
      INSERT INTO browser_decision_log (id, domain, decision, source, created_at)
      VALUES ${logRows.join(',')}
    `);

    const auditRows = [];
    for (let i = 0; i < 1000; i++) {
      auditRows.push(`('${crypto.randomUUID()}', now() - (${i} || ' seconds')::interval, 'p23-seed', 'domain_upsert', 'p23-explain-domain-${i % 2000}.com', 'GLOBAL', 'ALLOW', ${i})`);
    }
    await rawPool.query(`
      INSERT INTO browser_policy_audit (id, created_at, actor, action, domain, scope, new_decision, policy_version_after)
      VALUES ${auditRows.join(',')}
    `);
  }

  await test('query plans: seed realistic volumes (2000 domains, 5000 decision-log rows, 300 pending requests, 1000 audit rows)', async () => {
    await seedForExplain();
    const counts = await rawPool.query(`
      SELECT
        (SELECT count(*) FROM browser_domains) AS domains,
        (SELECT count(*) FROM browser_decision_log) AS log,
        (SELECT count(*) FROM browser_requests WHERE status = 'PENDING') AS pending,
        (SELECT count(*) FROM browser_policy_audit) AS audit
    `);
    console.log(`  (seeded: ${JSON.stringify(counts.rows[0])})`);
    assert.ok(Number(counts.rows[0].domains) >= 2000);
  });

  async function explain(label, sql, params) {
    const { rows } = await rawPool.query(`EXPLAIN ANALYZE ${sql}`, params);
    const plan = rows.map(r => r['QUERY PLAN']).join('\n');
    console.log(`\n  -- ${label} --\n  ${plan.split('\n').join('\n  ')}`);
    return plan;
  }

  await test('query plan: exact/global domain lookup (getBrowserDomainForHost)', async () => {
    const plan = await explain(
      'getBrowserDomainForHost (exact match on a real row)',
      `SELECT * FROM browser_domains WHERE domain = $1 OR (allow_subdomains AND $1 LIKE '%.' || domain) ORDER BY length(domain) DESC LIMIT 1`,
      ['p23-explain-domain-1000.com'],
    );
    assert.ok(plan.length > 0);
  });

  await test('query plan: per-device override lookup (getBrowserDeviceOverride)', async () => {
    const plan = await explain(
      'getBrowserDeviceOverride',
      `SELECT decision, reason FROM browser_device_overrides WHERE device_id = $1 AND domain = $2`,
      ['nonexistent-device', 'p23-explain-override-1.com'],
    );
    assert.ok(plan.includes('Index') || plan.includes('Seq Scan'), 'plan must be printed for the record either way');
  });

  await test('query plan: pending-request dedup lookup (recordBrowserRequest\'s SELECT)', async () => {
    const plan = await explain(
      'pending-request dedup lookup',
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`,
      ['p23-explain-pending-150.com'],
    );
    assert.ok(plan.length > 0);
  });

  await test('query plan: admin pending-request list (listPendingBrowserRequests)', async () => {
    const plan = await explain(
      'listPendingBrowserRequests (join + group by + order + limit 200)',
      `SELECT r.*,
              COUNT(rd.device_id) FILTER (WHERE rd.decision IS NULL)::int AS pending_device_count,
              COUNT(rd.device_id)::int AS total_device_count,
              MAX(rd.created_at) AS last_requested_at
         FROM browser_requests r
         LEFT JOIN browser_request_devices rd ON rd.request_id = r.id
        WHERE r.status = 'PENDING'
        GROUP BY r.id
        ORDER BY r.created_at ASC
        LIMIT 200`,
      [],
    );
    assert.ok(plan.length > 0);
  });

  await test('query plan: audit lookup, unfiltered (listBrowserPolicyAudit)', async () => {
    const plan = await explain(
      'listBrowserPolicyAudit (no domain filter, order by created_at desc limit 100)',
      `SELECT * FROM browser_policy_audit ORDER BY created_at DESC LIMIT 100`,
      [],
    );
    assert.ok(plan.length > 0);
  });

  await test('query plan: audit lookup, filtered by domain (listBrowserPolicyAudit)', async () => {
    const plan = await explain(
      'listBrowserPolicyAudit (WHERE domain = $1 order by created_at desc limit 100)',
      `SELECT * FROM browser_policy_audit WHERE domain = $1 ORDER BY created_at DESC LIMIT 100`,
      ['p23-explain-domain-500.com'],
    );
    assert.ok(plan.length > 0);
  });

  // ================= 5: RESTART / PERSISTENCE =================

  await test('restart/persistence: policyVersion, pending REVIEW, resolutions and audit all survive a real process restart', async () => {
    const RESTART_PORT = Number(process.env.RESTART_TEST_PORT) || 4332;
    const restartBaseUrl = `http://127.0.0.1:${RESTART_PORT}`;
    let proc = spawnBackend(RESTART_PORT);
    try {
      await waitForHealth(restartBaseUrl);

      const domain = 'p23-restart-allow.com';
      const reviewDomain = 'p23-restart-review.itest.com';
      const beforeVersion = await db.getBrowserPolicyVersion();

      // 1. An admin ALLOW write (bumps policyVersion, writes an audit row).
      await db.upsertBrowserDomain({
        domain, decision: 'ALLOW', allowSubdomains: false,
        approvalMethod: 'admin_manual', actor: 'p23-restart-seed',
      });
      // 2. A real pending REVIEW request, created through the actual HTTP path.
      const dev = await createTestDevice('restart-persist');
      const reviewRes = await deviceCheck(restartBaseUrl, dev.deviceId, dev.token, `https://${reviewDomain}/`);
      assert.strictEqual((await reviewRes.json()).decision, 'REVIEW');
      const { rows: pendingRows } = await rawPool.query(
        `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [reviewDomain],
      );
      assert.strictEqual(pendingRows.length, 1);
      const requestId = pendingRows[0].id;
      // 3. A DEVICE-scope resolution on a second, separate request.
      const dev2 = await createTestDevice('restart-device-resolve');
      const deviceReviewDomain = 'p23-restart-device-resolve.itest.com';
      await deviceCheck(restartBaseUrl, dev2.deviceId, dev2.token, `https://${deviceReviewDomain}/`);
      const { rows: pendingRows2 } = await rawPool.query(
        `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [deviceReviewDomain],
      );
      const resolved = await db.resolveBrowserRequest(pendingRows2[0].id, {
        scope: 'DEVICE', decision: 'BLOCK', deviceId: dev2.deviceId, actor: 'p23-restart-seed',
      });
      assert.ok(resolved && resolved.requestFullyResolved);

      const versionBeforeRestart = await db.getBrowserPolicyVersion();
      assert.ok(versionBeforeRestart > beforeVersion, 'policyVersion must have advanced from the writes above');
      const auditCountBefore = (await rawPool.query(`SELECT count(*)::int AS n FROM browser_policy_audit`)).rows[0].n;

      // ---- restart the process for real ----
      await killAndWait(proc);
      proc = spawnBackend(RESTART_PORT);
      await waitForHealth(restartBaseUrl);

      // Ground-truth re-check straight against Postgres (independent of
      // the newly-restarted process even having queried anything yet).
      const versionAfterRestart = await db.getBrowserPolicyVersion();
      assert.strictEqual(versionAfterRestart, versionBeforeRestart, 'policyVersion must be exactly what it was before restart, never rolled back');
      assert.ok(versionAfterRestart >= beforeVersion, 'policyVersion must never regress below its pre-test baseline either');

      const { rows: stillPending } = await rawPool.query(
        `SELECT status FROM browser_requests WHERE id = $1`, [requestId],
      );
      assert.strictEqual(stillPending[0].status, 'PENDING', 'the still-open REVIEW request must still be PENDING after restart');

      const { rows: stillResolved } = await rawPool.query(
        `SELECT status, resolution_scope FROM browser_requests WHERE id = $1`, [pendingRows2[0].id],
      );
      assert.strictEqual(stillResolved[0].status, 'RESOLVED');
      assert.strictEqual(stillResolved[0].resolution_scope, 'DEVICE');

      const auditCountAfter = (await rawPool.query(`SELECT count(*)::int AS n FROM browser_policy_audit`)).rows[0].n;
      assert.strictEqual(auditCountAfter, auditCountBefore, 'audit row count must be unchanged by a restart (no loss, no duplication)');

      // 4. Real end-to-end check through the FRESHLY RESTARTED process's
      // own HTTP endpoint - not just a raw DB read - that the ALLOW
      // decision from before the restart is still honored.
      const afterRestartCheck = await deviceCheck(restartBaseUrl, dev.deviceId, dev.token, `https://${domain}/`);
      assert.strictEqual(afterRestartCheck.status, 200);
      const afterBody = await afterRestartCheck.json();
      assert.strictEqual(afterBody.decision, 'ALLOW');
      assert.strictEqual(afterBody.policyVersion, versionAfterRestart);
    } finally {
      if (proc && proc.exitCode === null) {
        try { await killAndWait(proc, 5000); } catch { /* best-effort cleanup */ }
      }
    }
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
