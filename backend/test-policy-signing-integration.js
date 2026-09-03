// REAL PostgreSQL + real HTTP integration suite for the signed browser
// policy snapshot (Phase 2.4). Real local Postgres, a real running
// backend/index.js, a real Ed25519 keypair generated fresh for this run
// (never committed anywhere) - nothing here is mocked. A second, separate
// real backend process (spawned and killed by this file, distinct port)
// proves the missing/malformed-signing-key fail-closed path for real,
// over actual HTTP, not just at the unit level.
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
// This suite generates its own ephemeral Ed25519 keypair at startup and
// passes the private key to the fixture server via env var, exactly the
// way a real deployment would (PEM with escaped newlines) - see
// spawnMainServer() below. From backend/, in one shell:
//
//   (
//     export DATABASE_URL="postgresql://browser_test_user:browser_test_pw@127.0.0.1:5432/browser_test"
//     export DATABASE_SSL=disable
//     export ADMIN_USERNAME=itest_admin ADMIN_PASSWORD=itest_password_123
//     export JWT_SECRET=itest-jwt-secret-not-for-prod SECURE_COOKIES=0
//     node test-policy-signing-integration.js
//     exit $?
//   )
//
// Unlike the other integration suites, this file spawns/kills its OWN
// server processes (main fixture + a deliberately-broken one) rather than
// relying on an externally-launched fixture server, because the "missing
// signing key" test needs a process configured differently from the main
// one.
// ---------------------------------------------------------------------
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run this suite - refusing to fall back to a mock.');
  process.exit(1);
}

const db = require('./db');
const ps = require('./policySigning');
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
    const timer = setTimeout(() => reject(new Error('process did not exit within timeout')), timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
}

async function createTestDevice(label) {
  const deviceId = `pks-${label}-${crypto.randomUUID()}`;
  const token = crypto.randomBytes(16).toString('hex');
  await rawPool.query(`INSERT INTO devices (device_id, auth_token_hash) VALUES ($1, $2)`, [deviceId, sha256(token)]);
  return { deviceId, token };
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

async function snapshotFetch(baseUrl, deviceId, token) {
  return fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/browser/policy-snapshot`, {
    headers: token != null ? { Authorization: `Bearer ${token}` } : {},
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

async function setDeviceOverride(deviceId, domain, decision) {
  await rawPool.query(
    `INSERT INTO browser_device_overrides (device_id, domain, decision)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id, domain) DO UPDATE SET decision = EXCLUDED.decision`,
    [deviceId, domain, decision],
  );
}

(async () => {
  await db.init();
  await resetTestDatabase();

  // A real, freshly-generated Ed25519 keypair for this whole suite - never
  // written to disk anywhere in this repo, only held in memory and passed
  // to the child server process via env var, exactly like a real secret
  // manager would inject it at deploy time.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pemEnvValue = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
  const KEY_ID = 'itest-key-1';
  const MAIN_PORT = Number(process.env.MAIN_PORT) || 4371;
  const MAIN_URL = `http://127.0.0.1:${MAIN_PORT}`;

  let mainServer = spawnServer(MAIN_PORT, {
    BROWSER_POLICY_SIGNING_PRIVATE_KEY: pemEnvValue,
    BROWSER_POLICY_SIGNING_KEY_ID: KEY_ID,
  });
  await waitForHealth(MAIN_URL);
  const adminCookie = await adminLogin(MAIN_URL);
  const adminFetch = (p, opts = {}) => fetch(`${MAIN_URL}${p}`, {
    ...opts,
    headers: { Cookie: adminCookie, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  try {
    // ================= device auth enforcement =================

    await test('device auth: missing Authorization header -> 401, no envelope', async () => {
      const dev = await createTestDevice('noauth');
      const res = await snapshotFetch(MAIN_URL, dev.deviceId, null);
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.signature, undefined);
    });

    await test('device auth: wrong token -> 401, no envelope', async () => {
      const dev = await createTestDevice('wrongtoken');
      const res = await snapshotFetch(MAIN_URL, dev.deviceId, 'not-the-real-token');
      assert.strictEqual(res.status, 401);
    });

    await test('device auth: unknown device id -> 404, no envelope', async () => {
      const res = await snapshotFetch(MAIN_URL, 'pks-does-not-exist', 'irrelevant');
      assert.strictEqual(res.status, 404);
    });

    await test('device auth: correct token -> 200 with a real signed envelope', async () => {
      const dev = await createTestDevice('goodauth');
      const res = await snapshotFetch(MAIN_URL, dev.deviceId, dev.token);
      assert.strictEqual(res.status, 200);
      const envelope = await res.json();
      assert.strictEqual(envelope.keyId, KEY_ID);
      assert.strictEqual(envelope.algorithm, 'Ed25519');
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true, 'the real server-issued signature must verify against the real public key');
    });

    // ================= live policy content reflected correctly =================

    await test('a REVIEW-decision domain is excluded from the snapshot; ALLOW/BLOCK rows are included with correct fields', async () => {
      await db.upsertBrowserDomain({ domain: 'pks-allow.com', decision: 'ALLOW', allowSubdomains: true, approvalMethod: 'admin_manual', actor: 'itest' });
      await db.upsertBrowserDomain({ domain: 'pks-block.com', decision: 'BLOCK', allowSubdomains: false, approvalMethod: 'admin_manual', actor: 'itest' });
      // A REVIEW-decision row is only reachable today via the schema
      // default - inserted directly to prove exclusion regardless of how
      // such a row ever came to exist.
      await rawPool.query(
        `INSERT INTO browser_domains (domain, decision) VALUES ($1, 'REVIEW') ON CONFLICT (domain) DO UPDATE SET decision = 'REVIEW'`,
        ['pks-review.com'],
      );

      const dev = await createTestDevice('content');
      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const byDomain = Object.fromEntries(envelope.payload.globalDomains.map(d => [d.domain, d]));
      assert.deepStrictEqual(byDomain['pks-allow.com'], { domain: 'pks-allow.com', decision: 'ALLOW', allowSubdomains: true });
      assert.deepStrictEqual(byDomain['pks-block.com'], { domain: 'pks-block.com', decision: 'BLOCK', allowSubdomains: false });
      assert.strictEqual('pks-review.com' in byDomain, false, 'a REVIEW row must never appear in the offline snapshot');
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
    });

    // ================= device overrides: separation, precedence data, isolation =================

    await test('deviceOverrides is present and empty for a device with no overrides', async () => {
      const dev = await createTestDevice('no-overrides');
      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      assert.deepStrictEqual(envelope.payload.deviceOverrides, []);
    });

    await test('device override ALLOW is present in deviceOverrides even though the global rule for the same domain is BLOCK (precedence data available, not resolved server-side)', async () => {
      await db.upsertBrowserDomain({ domain: 'pks-override-allow.com', decision: 'BLOCK', allowSubdomains: false, approvalMethod: 'admin_manual', actor: 'itest' });
      const dev = await createTestDevice('override-allow');
      await setDeviceOverride(dev.deviceId, 'pks-override-allow.com', 'ALLOW');

      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const globalEntry = envelope.payload.globalDomains.find(d => d.domain === 'pks-override-allow.com');
      const overrideEntry = envelope.payload.deviceOverrides.find(d => d.domain === 'pks-override-allow.com');
      assert.strictEqual(globalEntry.decision, 'BLOCK', 'the global rule itself must still be reported as BLOCK - the snapshot never resolves precedence itself');
      assert.deepStrictEqual(overrideEntry, { domain: 'pks-override-allow.com', decision: 'ALLOW' });
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
    });

    await test('device override BLOCK is present in deviceOverrides even though the global rule for the same domain is ALLOW', async () => {
      await db.upsertBrowserDomain({ domain: 'pks-override-block.com', decision: 'ALLOW', allowSubdomains: false, approvalMethod: 'admin_manual', actor: 'itest' });
      const dev = await createTestDevice('override-block');
      await setDeviceOverride(dev.deviceId, 'pks-override-block.com', 'BLOCK');

      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const globalEntry = envelope.payload.globalDomains.find(d => d.domain === 'pks-override-block.com');
      const overrideEntry = envelope.payload.deviceOverrides.find(d => d.domain === 'pks-override-block.com');
      assert.strictEqual(globalEntry.decision, 'ALLOW');
      assert.deepStrictEqual(overrideEntry, { domain: 'pks-override-block.com', decision: 'BLOCK' });
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
    });

    await test('device A never receives device B\'s overrides (per-device isolation, enforced by the authenticated deviceId only)', async () => {
      const devA = await createTestDevice('isolation-a');
      const devB = await createTestDevice('isolation-b');
      await setDeviceOverride(devA.deviceId, 'pks-isolation-a-only.com', 'ALLOW');
      await setDeviceOverride(devB.deviceId, 'pks-isolation-b-only.com', 'BLOCK');

      const envelopeA = await (await snapshotFetch(MAIN_URL, devA.deviceId, devA.token)).json();
      const envelopeB = await (await snapshotFetch(MAIN_URL, devB.deviceId, devB.token)).json();

      assert.ok(envelopeA.payload.deviceOverrides.some(d => d.domain === 'pks-isolation-a-only.com'));
      assert.ok(!envelopeA.payload.deviceOverrides.some(d => d.domain === 'pks-isolation-b-only.com'), "device A's snapshot must never contain device B's override");
      assert.ok(envelopeB.payload.deviceOverrides.some(d => d.domain === 'pks-isolation-b-only.com'));
      assert.ok(!envelopeB.payload.deviceOverrides.some(d => d.domain === 'pks-isolation-a-only.com'), "device B's snapshot must never contain device A's override");
    });

    await test('a global allowSubdomains rule and an exact device override on a subdomain both appear, in their own correct arrays, without being flattened', async () => {
      // Global rule: *.pks-parent.com allowed (allowSubdomains: true) -
      // would cover pks-sub.pks-parent.com by ancestor matching alone.
      await db.upsertBrowserDomain({ domain: 'pks-parent.com', decision: 'ALLOW', allowSubdomains: true, approvalMethod: 'admin_manual', actor: 'itest' });
      const dev = await createTestDevice('subdomain-precedence');
      // This device has an exact-domain override BLOCKing one specific
      // subdomain - a verifier must check deviceOverrides FIRST (exact
      // match on pks-sub.pks-parent.com) before ever falling through to
      // the global ancestor-matching rule, exactly mirroring
      // browserPolicy.evaluateDomain's real precedence.
      await setDeviceOverride(dev.deviceId, 'pks-sub.pks-parent.com', 'BLOCK');

      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const globalEntry = envelope.payload.globalDomains.find(d => d.domain === 'pks-parent.com');
      const overrideEntry = envelope.payload.deviceOverrides.find(d => d.domain === 'pks-sub.pks-parent.com');
      assert.deepStrictEqual(globalEntry, { domain: 'pks-parent.com', decision: 'ALLOW', allowSubdomains: true });
      assert.deepStrictEqual(overrideEntry, { domain: 'pks-sub.pks-parent.com', decision: 'BLOCK' });
      // The override must never appear inside globalDomains (which would
      // silently blur which rule set it came from) and vice versa.
      assert.strictEqual(envelope.payload.globalDomains.some(d => d.domain === 'pks-sub.pks-parent.com'), false);
      assert.strictEqual(envelope.payload.deviceOverrides.some(d => d.domain === 'pks-parent.com'), false);
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
    });

    await test('deviceOverrides ordering is deterministic across repeated real fetches', async () => {
      const dev = await createTestDevice('override-ordering');
      await setDeviceOverride(dev.deviceId, 'pks-order-zzz.com', 'ALLOW');
      await setDeviceOverride(dev.deviceId, 'pks-order-aaa.com', 'BLOCK');
      await setDeviceOverride(dev.deviceId, 'pks-order-mmm.com', 'ALLOW');

      const first = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const second = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const namesFirst = first.payload.deviceOverrides.filter(d => d.domain.startsWith('pks-order-')).map(d => d.domain);
      const namesSecond = second.payload.deviceOverrides.filter(d => d.domain.startsWith('pks-order-')).map(d => d.domain);
      assert.deepStrictEqual(namesFirst, ['pks-order-aaa.com', 'pks-order-mmm.com', 'pks-order-zzz.com']);
      assert.deepStrictEqual(namesSecond, namesFirst);
    });

    await test('tampering with deviceOverrides on a real server-issued envelope invalidates its signature', async () => {
      const dev = await createTestDevice('tamper-override');
      await setDeviceOverride(dev.deviceId, 'pks-tamper-me.com', 'ALLOW');
      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);

      const tampered = JSON.parse(JSON.stringify(envelope));
      const entry = tampered.payload.deviceOverrides.find(d => d.domain === 'pks-tamper-me.com');
      entry.decision = 'BLOCK';
      assert.strictEqual(ps.verifySnapshot(tampered, publicKey), false);
    });

    // ================= policyVersion reflects live state, and is monotonic =================

    await test('policyVersion in the snapshot matches live browser_policy_meta, and strictly increases after a policy write', async () => {
      const dev = await createTestDevice('version');
      const before = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const liveVersionBefore = await db.getBrowserPolicyVersion();
      assert.strictEqual(before.payload.policyVersion, liveVersionBefore);

      await db.upsertBrowserDomain({ domain: 'pks-version-bump.com', decision: 'ALLOW', allowSubdomains: false, approvalMethod: 'admin_manual', actor: 'itest' });

      const after = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const liveVersionAfter = await db.getBrowserPolicyVersion();
      assert.strictEqual(after.payload.policyVersion, liveVersionAfter);
      assert.ok(after.payload.policyVersion > before.payload.policyVersion, 'policyVersion must strictly increase after a real policy write');
      assert.strictEqual(ps.verifySnapshot(after, publicKey), true);
    });

    // ================= determinism over real HTTP =================

    await test('two consecutive fetches with no policy change in between agree on policy content; each is internally consistent and correctly signed', async () => {
      // Each request builds a genuinely fresh snapshot (no server-side
      // caching - deliberate, so staleness is structurally impossible, see
      // docs/server-api-contract.md) - generatedAt/expiresAt are real
      // wall-clock timestamps and are EXPECTED to differ by a millisecond
      // or two between two real HTTP calls, which is exactly why the
      // signature legitimately differs too. "Determinism" here means: the
      // POLICY CONTENT (policyVersion + domains) is identical, and each
      // response's own expiresAt is exactly its own generatedAt + the
      // documented TTL, and each independently verifies - not byte-for-
      // byte identical envelopes across two different points in time. The
      // pure-clock-fixed determinism guarantee itself is already proven in
      // test-policy-signing.js.
      const dev = await createTestDevice('determinism');
      const first = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      const second = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();

      assert.strictEqual(first.payload.policyVersion, second.payload.policyVersion);
      assert.deepStrictEqual(first.payload.globalDomains, second.payload.globalDomains);
      assert.deepStrictEqual(first.payload.deviceOverrides, second.payload.deviceOverrides);
      for (const envelope of [first, second]) {
        const generatedAtMs = Date.parse(envelope.payload.generatedAt);
        const expiresAtMs = Date.parse(envelope.payload.expiresAt);
        assert.strictEqual(expiresAtMs - generatedAtMs, ps.SNAPSHOT_TTL_MS, 'expiresAt must be exactly generatedAt + the documented TTL');
        assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
      }
    });

    await test('a freshly-generated snapshot with the SAME policyVersion as a prior real fetch is accepted (200, valid signature) - equal is not a rollback', async () => {
      // Explicit, dedicated proof (beyond the determinism test above) that
      // the corrected anti-rollback contract holds over real HTTP: renewing
      // a snapshot with no policy change in between must succeed cleanly,
      // never be treated as suspicious just because the version repeats.
      const dev = await createTestDevice('same-version-renewal');
      const res1 = await snapshotFetch(MAIN_URL, dev.deviceId, dev.token);
      assert.strictEqual(res1.status, 200);
      const envelope1 = await res1.json();

      const res2 = await snapshotFetch(MAIN_URL, dev.deviceId, dev.token);
      assert.strictEqual(res2.status, 200);
      const envelope2 = await res2.json();

      assert.strictEqual(envelope1.payload.policyVersion, envelope2.payload.policyVersion);
      assert.strictEqual(ps.verifySnapshot(envelope1, publicKey), true);
      assert.strictEqual(ps.verifySnapshot(envelope2, publicKey), true);
    });

    // ================= admin public key endpoint matches what actually signed =================

    await test('GET /api/browser/policy/signing-key (admin) exposes exactly the public key that verifies real snapshots, never private material', async () => {
      const res = await adminFetch('/api/browser/policy/signing-key');
      assert.strictEqual(res.status, 200);
      const info = await res.json();
      assert.strictEqual(info.keyId, KEY_ID);
      assert.strictEqual(info.algorithm, 'Ed25519');
      assert.ok(!JSON.stringify(info).includes('PRIVATE KEY'));

      const exposedPublicKey = crypto.createPublicKey({ key: info.publicKeyPem, format: 'pem' });
      const dev = await createTestDevice('pubkey-check');
      const envelope = await (await snapshotFetch(MAIN_URL, dev.deviceId, dev.token)).json();
      assert.strictEqual(ps.verifySnapshot(envelope, exposedPublicKey), true);

      // The raw base64 encoding must decode to the identical 32 raw bytes.
      const rawFromPem = crypto.createPublicKey({ key: info.publicKeyPem, format: 'pem' }).export({ format: 'jwk' }).x;
      const rawFromBase64 = Buffer.from(info.publicKeyBase64, 'base64').toString('base64url');
      assert.strictEqual(rawFromBase64.replace(/=+$/, ''), rawFromPem.replace(/=+$/, ''));
    });

    await test('the admin signing-key endpoint requires admin auth, same as every other admin endpoint', async () => {
      const res = await fetch(`${MAIN_URL}/api/browser/policy/signing-key`);
      assert.strictEqual(res.status, 401);
    });
  } finally {
    if (mainServer) await killAndWait(mainServer).catch(() => {});
  }

  // ================= fail-closed: missing signing key, real process, real HTTP =================

  const NOKEY_PORT = Number(process.env.NOKEY_PORT) || 4372;
  const NOKEY_URL = `http://127.0.0.1:${NOKEY_PORT}`;
  let nokeyServer = spawnServer(NOKEY_PORT, {
    BROWSER_POLICY_SIGNING_PRIVATE_KEY: '',
    BROWSER_POLICY_SIGNING_KEY_ID: '',
  });
  try {
    await waitForHealth(NOKEY_URL);
    await test('fail-closed: a real server process with NO signing key configured returns 5xx, never an unsigned envelope', async () => {
      const dev = await createTestDevice('nokey');
      const res = await snapshotFetch(NOKEY_URL, dev.deviceId, dev.token);
      assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
      const text = await res.text();
      assert.ok(!text.includes('"signature"'), 'a missing signing key must never produce anything shaped like a signed envelope');
    });
  } finally {
    if (nokeyServer) await killAndWait(nokeyServer).catch(() => {});
  }

  // ================= fail-closed: malformed signing key, real process, real HTTP =================

  const BADKEY_PORT = Number(process.env.BADKEY_PORT) || 4373;
  const BADKEY_URL = `http://127.0.0.1:${BADKEY_PORT}`;
  let badkeyServer = spawnServer(BADKEY_PORT, {
    BROWSER_POLICY_SIGNING_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nbm90IGEgcmVhbCBrZXk=\\n-----END PRIVATE KEY-----',
    BROWSER_POLICY_SIGNING_KEY_ID: 'bad-key',
  });
  try {
    await waitForHealth(BADKEY_URL);
    await test('fail-closed: a real server process with a MALFORMED signing key returns 5xx, never an unsigned envelope', async () => {
      const dev = await createTestDevice('badkey');
      const res = await snapshotFetch(BADKEY_URL, dev.deviceId, dev.token);
      assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
    });
  } finally {
    if (badkeyServer) await killAndWait(badkeyServer).catch(() => {});
  }

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
