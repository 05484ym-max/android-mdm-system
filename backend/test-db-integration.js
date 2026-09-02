// REAL PostgreSQL integration test suite for the Filtered Browser backend
// (Server Phase 2.1). Every test here runs against a real local Postgres
// database and, for the auth/endpoint tests, a real running instance of
// this same backend (index.js) over real HTTP - nothing here is mocked.
//
// Requires (set by the caller, see the shell wrapper that launches this):
//   DATABASE_URL, DATABASE_SSL=disable  - the test Postgres database
//   TEST_BASE_URL                        - base URL of a running backend
//                                          instance pointed at the same DB
//   ADMIN_USERNAME, ADMIN_PASSWORD       - must match what that instance
//                                          was started with
//
// This file requires ./db directly (for the deep DB-semantics tests:
// concurrency, rollback, versioning - calling the exact same functions
// index.js's routes call) AND makes real HTTP requests against a
// separately-running server process (for auth/endpoint-integration tests,
// where going through requireAdmin/requireDevice middleware for real is
// the point). See docs/server-progress.md for how this is invoked.
//
// ---------------------------------------------------------------------
// One-time local setup (a real local PostgreSQL server - not Docker,
// not a mock - this environment had `postgresql-16` already installed;
// adjust if yours doesn't):
//
//   service postgresql start
//   sudo -u postgres psql \
//     -c "DROP DATABASE IF EXISTS browser_test;" \
//     -c "DROP ROLE IF EXISTS browser_test_user;" \
//     -c "CREATE ROLE browser_test_user LOGIN PASSWORD 'browser_test_pw';" \
//     -c "CREATE DATABASE browser_test OWNER browser_test_user;"
//
// Then, from backend/, in one shell (starts the real server, runs this
// suite against it over real HTTP + a direct DB connection, tears the
// server down afterward, and exits non-zero if anything failed):
//
//   (
//     export DATABASE_URL="postgresql://browser_test_user:browser_test_pw@127.0.0.1:5432/browser_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     export PORT=4321 TEST_BASE_URL=http://127.0.0.1:4321
//     node index.js > /tmp/server.log 2>&1 &
//     SERVER_PID=$!
//     node test-db-integration.js
//     EXIT_CODE=$?
//     kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null
//     exit $EXIT_CODE
//   )
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { Pool } = require('pg');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4321';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const rawPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

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
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server at ${BASE_URL} did not become ready within ${timeoutMs}ms`);
}

async function createTestDevice(label) {
  const deviceId = `it-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(
    `INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`,
    [deviceId, sha256(token)],
  );
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

async function deviceCheck(deviceId, token, url) {
  return fetch(`${BASE_URL}/api/devices/${encodeURIComponent(deviceId)}/browser/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token != null ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ url }),
  });
}

async function resetTestDatabase() {
  // Full reset so this suite is deterministic and re-runnable. Order
  // matters for the explicit list even though CASCADE would also catch
  // dependents - being explicit documents exactly what "a clean slate"
  // means for this suite.
  await rawPool.query(`
    TRUNCATE browser_policy_audit, browser_decision_log, browser_request_devices,
             browser_requests, browser_device_overrides, browser_domains,
             commands, alerts, enrollments, devices
    RESTART IDENTITY CASCADE
  `);
  await rawPool.query(`UPDATE browser_policy_meta SET value = 1 WHERE key = 'policy_version'`);
}

// A trigger used ONLY by the rollback tests (section 11) to force a real,
// late-in-transaction failure inside the actual db.js functions, without
// modifying db.js itself. REVOKE-based fault injection doesn't work here:
// the test role OWNS these tables (it ran db.init()), and a table owner's
// privileges bypass GRANT/REVOKE entirely in Postgres. A trigger that only
// fires for one sentinel `actor` value is deterministic, scoped to this
// test database, and fires on the real INSERT INTO browser_policy_audit
// statement that is genuinely the last statement in both
// upsertBrowserDomain and resolveBrowserRequest before COMMIT.
async function installRollbackTrigger() {
  await rawPool.query(`
    CREATE OR REPLACE FUNCTION __test_force_audit_failure() RETURNS trigger AS $$
    BEGIN
      IF NEW.actor = '__force_rollback_test__' THEN
        RAISE EXCEPTION 'forced failure for integration rollback test';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await rawPool.query(`DROP TRIGGER IF EXISTS __test_force_audit_failure_trigger ON browser_policy_audit`);
  await rawPool.query(`
    CREATE TRIGGER __test_force_audit_failure_trigger
      BEFORE INSERT ON browser_policy_audit
      FOR EACH ROW EXECUTE FUNCTION __test_force_audit_failure();
  `);
}

async function removeRollbackTrigger() {
  await rawPool.query(`DROP TRIGGER IF EXISTS __test_force_audit_failure_trigger ON browser_policy_audit`);
  await rawPool.query(`DROP FUNCTION IF EXISTS __test_force_audit_failure()`);
}

(async () => {
  await waitForServer();
  await db.init(); // exercises real schema creation/migration (section 1)
  await resetTestDatabase();
  await adminLogin();

  // ================= 1-3: schema / tables =================

  await test('schema: every required browser_* table exists', async () => {
    const { rows } = await rawPool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'browser_%'
    `);
    const names = new Set(rows.map(r => r.table_name));
    for (const t of [
      'browser_domains', 'browser_device_overrides', 'browser_requests',
      'browser_request_devices', 'browser_decision_log', 'browser_policy_meta',
      'browser_policy_audit',
    ]) {
      assert.ok(names.has(t), `missing table: ${t}`);
    }
  });

  await test('schema: browser_request_devices has the Phase 2 decision/resolved_at columns', async () => {
    const { rows } = await rawPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'browser_request_devices'`,
    );
    const cols = new Set(rows.map(r => r.column_name));
    assert.ok(cols.has('decision'));
    assert.ok(cols.has('resolved_at'));
  });

  await test('schema: browser_policy_audit has every documented column', async () => {
    const { rows } = await rawPool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'browser_policy_audit'`,
    );
    const cols = new Set(rows.map(r => r.column_name));
    for (const c of [
      'id', 'created_at', 'actor', 'action', 'domain', 'scope', 'device_id',
      'old_decision', 'new_decision', 'reason', 'policy_version_after',
    ]) {
      assert.ok(cols.has(c), `missing column: ${c}`);
    }
  });

  await test('schema: re-running db.init() is idempotent (safe migration re-run)', async () => {
    await db.init(); // must not throw the second time
    const { rows } = await rawPool.query(`SELECT value FROM browser_policy_meta WHERE key = 'policy_version'`);
    assert.strictEqual(rows.length, 1, 'INSERT ... ON CONFLICT DO NOTHING must not duplicate the seed row');
  });

  // ================= 4: policyVersion =================

  await test('policyVersion: starts at the known baseline after reset', async () => {
    assert.strictEqual(await db.getBrowserPolicyVersion(), 1);
  });

  await test('policyVersion: increases by exactly 1 on domain_upsert', async () => {
    const before = await db.getBrowserPolicyVersion();
    await db.upsertBrowserDomain({ domain: 'pv1.itest.com', decision: 'ALLOW', actor: 'test' });
    assert.strictEqual(await db.getBrowserPolicyVersion(), before + 1);
  });

  await test('policyVersion: increases by exactly 1 on domain_delete', async () => {
    const before = await db.getBrowserPolicyVersion();
    const deleted = await db.deleteBrowserDomain('pv1.itest.com', { actor: 'test' });
    assert.strictEqual(deleted, true);
    assert.strictEqual(await db.getBrowserPolicyVersion(), before + 1);
  });

  await test('policyVersion: strictly increases across a sequence of different mutation types, never decreases', async () => {
    const dev = await createTestDevice('pvseq');
    const versions = [await db.getBrowserPolicyVersion()];

    await db.upsertBrowserDomain({ domain: 'pvseq1.itest.com', decision: 'REVIEW', actor: 'seq' });
    versions.push(await db.getBrowserPolicyVersion());

    await db.recordBrowserRequest(crypto.randomUUID(), { domain: 'pvseq2.itest.com', deviceId: dev.deviceId });
    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = 'pvseq2.itest.com' AND status = 'PENDING'`,
    );
    await db.resolveBrowserRequest(rows[0].id, { scope: 'DEVICE', deviceId: dev.deviceId, decision: 'ALLOW', actor: 'seq' });
    versions.push(await db.getBrowserPolicyVersion());

    await db.deleteBrowserDomain('pvseq1.itest.com', { actor: 'seq' });
    versions.push(await db.getBrowserPolicyVersion());

    for (let i = 1; i < versions.length; i++) {
      assert.ok(versions[i] > versions[i - 1], `must strictly increase, got ${versions.join(' -> ')}`);
    }
  });

  // ================= 5: decisionVersion =================

  await test('decisionVersion: first insert = 1', async () => {
    const d = await db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'ALLOW', actor: 'test' });
    assert.strictEqual(d.decisionVersion, 1);
  });

  await test('decisionVersion: ALLOW -> BLOCK increments to 2', async () => {
    const d = await db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'BLOCK', actor: 'test' });
    assert.strictEqual(d.decisionVersion, 2);
    assert.strictEqual(d.decision, 'BLOCK');
  });

  await test('decisionVersion: BLOCK -> ALLOW increments to 3', async () => {
    const d = await db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'ALLOW', actor: 'test' });
    assert.strictEqual(d.decisionVersion, 3);
  });

  await test('decisionVersion: a metadata-only update (same decision) still increments - documented existing behavior, not a bug', async () => {
    const d = await db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'ALLOW', category: 'news', actor: 'test' });
    assert.strictEqual(d.decisionVersion, 4);
  });

  await test('decisionVersion: two concurrent upserts on the SAME domain both apply - none lost to a lost-update race', async () => {
    const before = (await db.getBrowserDomainForHost('dv1.itest.com')).decisionVersion;
    await Promise.all([
      db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'BLOCK', actor: 'race-a' }),
      db.upsertBrowserDomain({ domain: 'dv1.itest.com', decision: 'ALLOW', actor: 'race-b' }),
    ]);
    const after = await db.getBrowserDomainForHost('dv1.itest.com');
    assert.strictEqual(after.decisionVersion, before + 2, 'the SELECT ... FOR UPDATE row lock must serialize both writers');
  });

  // ================= 6: request deduplication =================

  await test('deduplication: 5 concurrent devices requesting a brand-new domain produce exactly one PENDING request', async () => {
    const domain = 'dedupe1.itest.com';
    const devices = await Promise.all([1, 2, 3, 4, 5].map(i => createTestDevice(`dedupe-${i}`)));
    await Promise.all(devices.map(d => db.recordBrowserRequest(
      crypto.randomUUID(), { domain, url: `https://${domain}/`, deviceId: d.deviceId },
    )));

    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [domain],
    );
    assert.strictEqual(rows.length, 1, 'exactly one PENDING request row - no duplicate jobs under concurrency');

    const { rows: deviceRows } = await rawPool.query(
      `SELECT device_id FROM browser_request_devices WHERE request_id = $1`, [rows[0].id],
    );
    assert.strictEqual(deviceRows.length, 5, 'one browser_request_devices row per distinct device');

    const pending = await db.listPendingBrowserRequests();
    const entry = pending.find(r => r.domain === domain);
    assert.strictEqual(entry.requesterCount, 5);
    assert.strictEqual(entry.totalRequesterCount, 5);
  });

  // ================= 7-8: DEVICE resolution, shared request =================

  let devA, devB, devscopeDomain, devscopeRequestId;

  await test('device-scope: two devices share one request', async () => {
    devscopeDomain = 'devscope1.itest.com';
    devA = await createTestDevice('devscope-a');
    devB = await createTestDevice('devscope-b');
    await db.recordBrowserRequest(crypto.randomUUID(), { domain: devscopeDomain, deviceId: devA.deviceId });
    await db.recordBrowserRequest(crypto.randomUUID(), { domain: devscopeDomain, deviceId: devB.deviceId });
    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [devscopeDomain],
    );
    assert.strictEqual(rows.length, 1);
    devscopeRequestId = rows[0].id;
  });

  await test('device-scope: resolving A only leaves B pending, parent request stays PENDING', async () => {
    const result = await db.resolveBrowserRequest(
      devscopeRequestId, { scope: 'DEVICE', deviceId: devA.deviceId, decision: 'ALLOW', actor: 'test' },
    );
    assert.ok(result);
    assert.strictEqual(result.scope, 'DEVICE');
    assert.strictEqual(result.requestFullyResolved, false);

    const devices = await db.listBrowserRequestDevices(devscopeRequestId);
    assert.strictEqual(devices.find(x => x.deviceId === devA.deviceId).decision, 'ALLOW');
    assert.strictEqual(devices.find(x => x.deviceId === devB.deviceId).decision, null, 'B must remain pending');

    const { rows } = await rawPool.query(`SELECT status FROM browser_requests WHERE id = $1`, [devscopeRequestId]);
    assert.strictEqual(rows[0].status, 'PENDING');

    const pending = await db.listPendingBrowserRequests();
    assert.strictEqual(pending.find(r => r.domain === devscopeDomain).requesterCount, 1, 'only B still waiting');

    const { rows: overrides } = await rawPool.query(
      `SELECT device_id FROM browser_device_overrides WHERE domain = $1`, [devscopeDomain],
    );
    assert.strictEqual(overrides.length, 1, 'browser_device_overrides written only for A');
    assert.strictEqual(overrides[0].device_id, devA.deviceId);
  });

  await test('device-scope: resolving B closes the request; A is never overwritten', async () => {
    const result = await db.resolveBrowserRequest(
      devscopeRequestId, { scope: 'DEVICE', deviceId: devB.deviceId, decision: 'BLOCK', actor: 'test' },
    );
    assert.ok(result);
    assert.strictEqual(result.requestFullyResolved, true);

    const { rows } = await rawPool.query(
      `SELECT status, resolution_scope FROM browser_requests WHERE id = $1`, [devscopeRequestId],
    );
    assert.strictEqual(rows[0].status, 'RESOLVED');
    assert.strictEqual(rows[0].resolution_scope, 'DEVICE');

    const { rows: overrides } = await rawPool.query(
      `SELECT device_id, decision FROM browser_device_overrides WHERE domain = $1`, [devscopeDomain],
    );
    const aOverride = overrides.find(o => o.device_id === devA.deviceId);
    assert.strictEqual(aOverride.decision, 'ALLOW', "A's earlier decision must survive untouched");
  });

  // ================= 9: GLOBAL resolution =================

  let globalDomain, globalRequestId, devGA, devGB, devGC;

  await test('global-scope: three devices share a request, one already resolved individually', async () => {
    globalDomain = 'global1.itest.com';
    devGA = await createTestDevice('global-a');
    devGB = await createTestDevice('global-b');
    devGC = await createTestDevice('global-c');
    for (const d of [devGA, devGB, devGC]) {
      await db.recordBrowserRequest(crypto.randomUUID(), { domain: globalDomain, deviceId: d.deviceId });
    }
    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [globalDomain],
    );
    globalRequestId = rows[0].id;
    await db.resolveBrowserRequest(
      globalRequestId, { scope: 'DEVICE', deviceId: devGA.deviceId, decision: 'BLOCK', actor: 'test' },
    );
  });

  await test('global-scope: GLOBAL resolution answers B and C, never overwrites A, writes browser_domains + audit, bumps policyVersion once', async () => {
    const versionBefore = await db.getBrowserPolicyVersion();
    const result = await db.resolveBrowserRequest(
      globalRequestId, { scope: 'GLOBAL', decision: 'ALLOW', actor: 'test' },
    );
    assert.ok(result);
    assert.strictEqual(result.scope, 'GLOBAL');
    assert.strictEqual(await db.getBrowserPolicyVersion(), versionBefore + 1, 'exactly one bump for the whole call');

    const devices = await db.listBrowserRequestDevices(globalRequestId);
    assert.strictEqual(devices.find(x => x.deviceId === devGA.deviceId).decision, 'BLOCK', "A's individual answer must survive a later GLOBAL resolve");
    assert.strictEqual(devices.find(x => x.deviceId === devGB.deviceId).decision, 'ALLOW');
    assert.strictEqual(devices.find(x => x.deviceId === devGC.deviceId).decision, 'ALLOW');

    const rule = await db.getBrowserDomainForHost(globalDomain);
    assert.strictEqual(rule.decision, 'ALLOW');

    const { rows } = await rawPool.query(`SELECT status FROM browser_requests WHERE id = $1`, [globalRequestId]);
    assert.strictEqual(rows[0].status, 'RESOLVED');

    const audit = await db.listBrowserPolicyAudit({ domain: globalDomain });
    assert.ok(audit.some(a => a.action === 'request_resolve_global' && a.newDecision === 'ALLOW'));
  });

  // ================= 10: real concurrency =================

  await test('concurrency: two concurrent DEVICE resolves for the same (request, device) - exactly one wins', async () => {
    const domain = 'race1.itest.com';
    const dev = await createTestDevice('race1');
    await db.recordBrowserRequest(crypto.randomUUID(), { domain, deviceId: dev.deviceId });
    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [domain],
    );
    const requestId = rows[0].id;

    const [r1, r2] = await Promise.all([
      db.resolveBrowserRequest(requestId, { scope: 'DEVICE', deviceId: dev.deviceId, decision: 'ALLOW', actor: 'race-1' }),
      db.resolveBrowserRequest(requestId, { scope: 'DEVICE', deviceId: dev.deviceId, decision: 'BLOCK', actor: 'race-2' }),
    ]);
    const winners = [r1, r2].filter(r => r !== null);
    assert.strictEqual(winners.length, 1, 'exactly one of the two concurrent resolves may win');

    const { rows: overrides } = await rawPool.query(
      `SELECT decision FROM browser_device_overrides WHERE device_id = $1 AND domain = $2`, [dev.deviceId, domain],
    );
    assert.strictEqual(overrides.length, 1, 'no double mutation');

    const audit = await db.listBrowserPolicyAudit({ domain });
    assert.strictEqual(audit.filter(a => a.action === 'request_resolve_device').length, 1, 'no double audit');
  });

  await test('concurrency: two concurrent GLOBAL resolves for the same request - exactly one wins', async () => {
    const domain = 'race2.itest.com';
    const dev = await createTestDevice('race2');
    await db.recordBrowserRequest(crypto.randomUUID(), { domain, deviceId: dev.deviceId });
    const { rows } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [domain],
    );
    const requestId = rows[0].id;

    const [r1, r2] = await Promise.all([
      db.resolveBrowserRequest(requestId, { scope: 'GLOBAL', decision: 'ALLOW', actor: 'race-1' }),
      db.resolveBrowserRequest(requestId, { scope: 'GLOBAL', decision: 'BLOCK', actor: 'race-2' }),
    ]);
    const winners = [r1, r2].filter(r => r !== null);
    assert.strictEqual(winners.length, 1, 'exactly one of the two concurrent GLOBAL resolves may win');

    const { rows: domainRows } = await rawPool.query(
      `SELECT decision_version FROM browser_domains WHERE domain = $1`, [domain],
    );
    assert.strictEqual(domainRows.length, 1);
    assert.strictEqual(domainRows[0].decision_version, 1, 'only one write happened, not two');
  });

  // ================= 11: real rollback (forced late-transaction failure) =================

  await installRollbackTrigger();

  await test('rollback: a forced failure in upsertBrowserDomain leaves no partial state', async () => {
    const domain = 'rollback1.itest.com';
    const versionBefore = await db.getBrowserPolicyVersion();
    await assert.rejects(() => db.upsertBrowserDomain({
      domain, decision: 'ALLOW', actor: '__force_rollback_test__',
    }));
    const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = $1`, [domain]);
    assert.strictEqual(rows.length, 0, 'no partial browser_domains row after a failed transaction');
    assert.strictEqual(await db.getBrowserPolicyVersion(), versionBefore, 'policyVersion must be unchanged after rollback');
  });

  await test('rollback: a forced failure in resolveBrowserRequest(GLOBAL) leaves the request PENDING and writes nothing', async () => {
    const domain = 'rollback2.itest.com';
    const dev = await createTestDevice('rollback2');
    await db.recordBrowserRequest(crypto.randomUUID(), { domain, deviceId: dev.deviceId });
    const { rows: reqRows0 } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [domain],
    );
    const requestId = reqRows0[0].id;
    const versionBefore = await db.getBrowserPolicyVersion();

    await assert.rejects(() => db.resolveBrowserRequest(
      requestId, { scope: 'GLOBAL', decision: 'ALLOW', actor: '__force_rollback_test__' },
    ));

    const { rows: reqRows } = await rawPool.query(`SELECT status FROM browser_requests WHERE id = $1`, [requestId]);
    assert.strictEqual(reqRows[0].status, 'PENDING', 'a failed transaction must never leave the request marked resolved');

    const { rows: domainRows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = $1`, [domain]);
    assert.strictEqual(domainRows.length, 0, 'no browser_domains row without the request actually having closed, and vice versa');

    const { rows: deviceRows } = await rawPool.query(
      `SELECT decision FROM browser_request_devices WHERE request_id = $1`, [requestId],
    );
    assert.strictEqual(deviceRows[0].decision, null, 'device row must not be stamped by a failed transaction');
    assert.strictEqual(await db.getBrowserPolicyVersion(), versionBefore, 'policyVersion must be unchanged after rollback');
  });

  await test('rollback: a forced failure in resolveBrowserRequest(DEVICE) leaves no override and no partial device state', async () => {
    const domain = 'rollback3.itest.com';
    const dev = await createTestDevice('rollback3');
    await db.recordBrowserRequest(crypto.randomUUID(), { domain, deviceId: dev.deviceId });
    const { rows: reqRows0 } = await rawPool.query(
      `SELECT id FROM browser_requests WHERE domain = $1 AND status = 'PENDING'`, [domain],
    );
    const requestId = reqRows0[0].id;

    await assert.rejects(() => db.resolveBrowserRequest(
      requestId, { scope: 'DEVICE', deviceId: dev.deviceId, decision: 'ALLOW', actor: '__force_rollback_test__' },
    ));

    const { rows: overrides } = await rawPool.query(
      `SELECT 1 FROM browser_device_overrides WHERE device_id = $1 AND domain = $2`, [dev.deviceId, domain],
    );
    assert.strictEqual(overrides.length, 0, 'no orphaned override after a failed transaction');
    const { rows: deviceRows } = await rawPool.query(
      `SELECT decision FROM browser_request_devices WHERE request_id = $1 AND device_id = $2`, [requestId, dev.deviceId],
    );
    assert.strictEqual(deviceRows[0].decision, null);
  });

  await removeRollbackTrigger();

  // ================= 12: domain validation vs. real DB write (via real HTTP) =================

  const REJECT_CASES = [
    ['github.io', 'github.io'],
    ['blogspot.com', 'blogspot.com'],
    ['appspot.com', 'appspot.com'],
    ['co.uk', 'co.uk'],
    ['192.168.1.1', '192.168.1.1'],
    ['https://reject-scheme.itest.com', 'reject-scheme.itest.com'],
    ['reject-path.itest.com/x', 'reject-path.itest.com'],
    ['reject-port.itest.com:443', 'reject-port.itest.com'],
    ['*.reject-wild.itest.com', 'reject-wild.itest.com'],
  ];
  for (const [input, probeDomain] of REJECT_CASES) {
    await test(`http validation: POST /api/browser/domains rejects "${input}" and it never reaches the DB`, async () => {
      const res = await adminFetch('/api/browser/domains', {
        method: 'POST', body: JSON.stringify({ domain: input, decision: 'ALLOW' }),
      });
      assert.strictEqual(res.status, 400, `expected 400 for "${input}", got ${res.status}`);
      const { rows } = await rawPool.query(`SELECT 1 FROM browser_domains WHERE domain = $1`, [probeDomain]);
      assert.strictEqual(rows.length, 0);
    });
  }

  await test('http validation: uppercase + trailing dot normalize to the same canonical row', async () => {
    const res = await adminFetch('/api/browser/domains', {
      method: 'POST', body: JSON.stringify({ domain: 'NORM-TEST.ITEST.COM.', decision: 'ALLOW' }),
    });
    assert.strictEqual(res.status, 200);
    const { rows } = await rawPool.query(`SELECT domain FROM browser_domains WHERE domain = 'norm-test.itest.com'`);
    assert.strictEqual(rows.length, 1);
  });

  await test('http validation: Unicode and Punycode forms of the same domain write to the identical row, never two', async () => {
    const res1 = await adminFetch('/api/browser/domains', {
      method: 'POST', body: JSON.stringify({ domain: 'müncheni-test.de', decision: 'ALLOW' }),
    });
    assert.strictEqual(res1.status, 200);
    const body1 = await res1.json();
    const res2 = await adminFetch('/api/browser/domains', {
      method: 'POST', body: JSON.stringify({ domain: body1.domain, decision: 'BLOCK' }),
    });
    assert.strictEqual(res2.status, 200);
    const { rows } = await rawPool.query(`SELECT decision_version FROM browser_domains WHERE domain = $1`, [body1.domain]);
    assert.strictEqual(rows.length, 1, 'must be exactly one row for the Unicode/Punycode-equivalent domain');
    assert.strictEqual(rows[0].decision_version, 2, 'the second write must be an UPDATE of the same row, not a new insert');
  });

  // ================= 13: audit trail (real DB) =================

  await test('audit: domain_upsert row has the correct fields', async () => {
    const domain = 'audit1.itest.com';
    await db.upsertBrowserDomain({ domain, decision: 'ALLOW', actor: 'audit-tester', reason: 'seed' });
    const e = (await db.listBrowserPolicyAudit({ domain })).find(x => x.action === 'domain_upsert');
    assert.ok(e);
    assert.strictEqual(e.scope, 'GLOBAL');
    assert.strictEqual(e.newDecision, 'ALLOW');
    assert.strictEqual(e.oldDecision, null);
    assert.strictEqual(e.actor, 'audit-tester');
    assert.ok(e.policyVersionAfter > 0);
  });

  await test('audit: domain_delete row captures oldDecision and a null newDecision', async () => {
    const domain = 'audit1.itest.com';
    await db.deleteBrowserDomain(domain, { actor: 'audit-tester', reason: 'cleanup' });
    const e = (await db.listBrowserPolicyAudit({ domain })).find(x => x.action === 'domain_delete');
    assert.ok(e);
    assert.strictEqual(e.oldDecision, 'ALLOW');
    assert.strictEqual(e.newDecision, null);
  });

  await test('audit: GLOBAL and DEVICE resolves both produce correctly-shaped rows', async () => {
    const globalAudit = await db.listBrowserPolicyAudit({ domain: globalDomain });
    assert.ok(globalAudit.some(a => a.action === 'request_resolve_global' && a.scope === 'GLOBAL' && a.deviceId === null));
    const deviceAudit = await db.listBrowserPolicyAudit({ domain: devscopeDomain });
    assert.ok(deviceAudit.some(a => a.action === 'request_resolve_device' && a.scope === 'DEVICE' && a.deviceId === devA.deviceId));
  });

  // ================= 14: auth integration (real HTTP) =================

  await test('auth: admin endpoint without a session is rejected (401)', async () => {
    const res = await fetch(`${BASE_URL}/api/browser/domains`);
    assert.strictEqual(res.status, 401);
  });

  await test('auth: admin endpoint with a valid session succeeds', async () => {
    const res = await adminFetch('/api/browser/domains');
    assert.strictEqual(res.status, 200);
  });

  await test('auth: device browser/check with a wrong token is rejected (401)', async () => {
    const dev = await createTestDevice('authtest-wrong');
    const res = await deviceCheck(dev.deviceId, 'totally-wrong-token', 'https://example.com/');
    assert.strictEqual(res.status, 401);
  });

  await test('auth: device browser/check with a mismatched deviceId/token pair is rejected (401)', async () => {
    const devX = await createTestDevice('authtest-x');
    const devY = await createTestDevice('authtest-y');
    const res = await deviceCheck(devX.deviceId, devY.token, 'https://example.com/');
    assert.strictEqual(res.status, 401);
  });

  await test('auth: an unknown deviceId is rejected (404)', async () => {
    const res = await deviceCheck('does-not-exist-device-id', 'whatever', 'https://example.com/');
    assert.strictEqual(res.status, 404);
  });

  await test('auth: device browser/check with a real matching token succeeds', async () => {
    const dev = await createTestDevice('authtest-ok');
    const res = await deviceCheck(dev.deviceId, dev.token, 'https://authtest-ok-target.itest.com/');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(['ALLOW', 'BLOCK', 'REVIEW'].includes(body.decision));
  });

  // ================= fail-closed sanity, end-to-end over real HTTP =================

  await test('fail-closed (end-to-end): a brand-new domain returns REVIEW, never ALLOW', async () => {
    const dev = await createTestDevice('failclosed-review');
    const res = await deviceCheck(dev.deviceId, dev.token, 'https://never-seen-before-xyz.itest.com/');
    const body = await res.json();
    assert.strictEqual(body.decision, 'REVIEW');
  });

  await test('fail-closed (end-to-end): a dangerous scheme returns an explicit BLOCK, never a silent pass', async () => {
    const dev = await createTestDevice('failclosed-scheme');
    const res = await deviceCheck(dev.deviceId, dev.token, 'javascript:alert(1)');
    const body = await res.json();
    assert.strictEqual(body.decision, 'BLOCK');
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
