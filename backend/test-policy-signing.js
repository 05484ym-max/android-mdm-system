// Pure (DB-free, network-free) unit tests for policySigning.js - Phase 2.4.
// Ephemeral Ed25519 keypairs are generated fresh at runtime for every test
// run (crypto.generateKeyPairSync) - no key material is ever committed to
// this repo or fixture file. Run directly with `node test-policy-signing.js`.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const ps = require('./policySigning');

let passed = 0;
function check(name, fn) {
  // The monotonicity high-water mark is deliberately process-global (see
  // policySigning.js) - real production traffic only ever moves forward,
  // but this test file's cases are semantically independent and each
  // picks its own policyVersion, so every test starts from a clean
  // tracker. The two tests specifically about monotonicity manage the
  // reset around their own multi-step sequence themselves.
  ps._resetMonotonicityTrackerForTests();
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const NOW = 1_700_000_000_000; // fixed clock, no wall-clock flakiness

function makeEnvVarPem(privateKey) {
  // Mirrors how a real deployment stores a multi-line PEM in a
  // single-line env var: real newlines become literal backslash-n.
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
}

// ================= real signature generation + verification =================

check('real signature generation + verification round-trips correctly', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({
    policyVersion: 3,
    now: NOW,
    domains: [{ domain: 'example.com', decision: 'ALLOW', allowSubdomains: false }],
  });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });
  assert.strictEqual(envelope.algorithm, 'Ed25519');
  assert.strictEqual(envelope.keyId, 'k1');
  assert.strictEqual(typeof envelope.signature, 'string');
  assert.strictEqual(Buffer.from(envelope.signature, 'base64').length, 64, 'an Ed25519 signature is always exactly 64 bytes');
  assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
});

check('verification fails against the WRONG public key (proves the signature is actually key-specific)', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, domains: [] });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });
  assert.strictEqual(ps.verifySnapshot(envelope, wrongPublicKey), false);
});

// ================= tampered payload rejected =================

check('a tampered payload (any field) fails verification', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({
    policyVersion: 5,
    now: NOW,
    domains: [{ domain: 'a.com', decision: 'ALLOW', allowSubdomains: false }],
  });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });

  const tamperedDomain = JSON.parse(JSON.stringify(envelope));
  tamperedDomain.payload.domains[0].decision = 'BLOCK';
  assert.strictEqual(ps.verifySnapshot(tamperedDomain, publicKey), false);

  const addedDomain = JSON.parse(JSON.stringify(envelope));
  addedDomain.payload.domains.push({ domain: 'evil.com', decision: 'ALLOW', allowSubdomains: true });
  assert.strictEqual(ps.verifySnapshot(addedDomain, publicKey), false);

  const tamperedExpiry = JSON.parse(JSON.stringify(envelope));
  tamperedExpiry.payload.expiresAt = new Date(NOW + ps.SNAPSHOT_TTL_MS * 100).toISOString();
  assert.strictEqual(ps.verifySnapshot(tamperedExpiry, publicKey), false);
});

// ================= tampered policyVersion rejected =================

check('a tampered policyVersion specifically fails verification (never silently accepted)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 10, now: NOW, domains: [] });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });

  const higher = JSON.parse(JSON.stringify(envelope));
  higher.payload.policyVersion = 11;
  assert.strictEqual(ps.verifySnapshot(higher, publicKey), false);

  const lower = JSON.parse(JSON.stringify(envelope));
  lower.payload.policyVersion = 9;
  assert.strictEqual(ps.verifySnapshot(lower, publicKey), false);
});

// ================= deterministic canonicalization =================

check('canonicalize() is independent of object key insertion order', () => {
  const a = { policyVersion: 1, generatedAt: 'x', expiresAt: 'y', domains: [] };
  const b = { expiresAt: 'y', domains: [], policyVersion: 1, generatedAt: 'x' };
  assert.strictEqual(ps.canonicalize(a), ps.canonicalize(b));
});

check('canonicalize() sorts keys recursively, including inside array elements', () => {
  const a = { domains: [{ decision: 'ALLOW', domain: 'x.com', allowSubdomains: false }] };
  const b = { domains: [{ domain: 'x.com', allowSubdomains: false, decision: 'ALLOW' }] };
  assert.strictEqual(ps.canonicalize(a), ps.canonicalize(b));
});

check('canonicalize() throws on undefined rather than silently emitting a corrupt byte stream', () => {
  assert.throws(() => ps.canonicalize({ a: undefined }));
  assert.throws(() => ps.canonicalize(undefined));
});

check('two independently-built snapshots of the same logical policy state produce byte-identical canonical bytes', () => {
  const buildOnce = () => ps.buildBrowserPolicySnapshot({
    policyVersion: 7,
    now: NOW,
    domains: [
      { domain: 'b.com', decision: 'BLOCK', allowSubdomains: false },
      { domain: 'a.com', decision: 'ALLOW', allowSubdomains: true },
    ],
  });
  const bytes1 = ps.canonicalPayloadBytes(buildOnce());
  const bytes2 = ps.canonicalPayloadBytes(buildOnce());
  assert.ok(bytes1.equals(bytes2));
});

// ================= domain ordering does not change the signature =================

check('domain ordering in the INPUT does not change the resulting canonical bytes/signature', () => {
  const domainsA = [
    { domain: 'zzz.com', decision: 'ALLOW', allowSubdomains: false },
    { domain: 'aaa.com', decision: 'BLOCK', allowSubdomains: true },
    { domain: 'mmm.com', decision: 'ALLOW', allowSubdomains: false },
  ];
  const domainsB = [domainsA[2], domainsA[0], domainsA[1]]; // same set, different input order
  const payloadA = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, domains: domainsA });
  const payloadB = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, domains: domainsB });
  assert.ok(ps.canonicalPayloadBytes(payloadA).equals(ps.canonicalPayloadBytes(payloadB)));
  // And the output order itself is normalized (sorted), not just coincidentally equal.
  assert.deepStrictEqual(payloadA.domains.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
  assert.deepStrictEqual(payloadB.domains.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
});

// ================= expired snapshot =================

check('isSnapshotExpired is false right after generation and at the exact expiry instant is true', () => {
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, domains: [] });
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW), false);
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW + ps.SNAPSHOT_TTL_MS - 1), false);
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW + ps.SNAPSHOT_TTL_MS), true);
});

check('isSnapshotExpired is true long after expiry', () => {
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, domains: [] });
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW + ps.SNAPSHOT_TTL_MS * 10), true);
});

// ================= missing/malformed signing key fail-closed =================

check('loadSigningConfig throws when both env vars are unset', () => {
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
  assert.throws(() => ps.loadSigningConfig(), /not configured/);
});

check('loadSigningConfig throws when the key is set but keyId is missing', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY = makeEnvVarPem(privateKey);
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
  assert.throws(() => ps.loadSigningConfig(), /not configured/);
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
});

check('loadSigningConfig throws on garbage PEM content (malformed key)', () => {
  process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nnot actually a key\n-----END PRIVATE KEY-----';
  process.env.BROWSER_POLICY_SIGNING_KEY_ID = 'k1';
  assert.throws(() => ps.loadSigningConfig(), /malformed/);
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
});

check('loadSigningConfig throws when the key is a real, valid key but the WRONG algorithm (RSA, not Ed25519)', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY = makeEnvVarPem(privateKey);
  process.env.BROWSER_POLICY_SIGNING_KEY_ID = 'k1';
  assert.throws(() => ps.loadSigningConfig(), /must be Ed25519/);
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
});

check('loadSigningConfig succeeds and round-trips signing with a correctly-configured real Ed25519 key (escaped-newline PEM)', () => {
  const { publicKey, privateKey: realPrivateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY = makeEnvVarPem(realPrivateKey);
  process.env.BROWSER_POLICY_SIGNING_KEY_ID = 'k-real';
  const { privateKey, keyId } = ps.loadSigningConfig();
  assert.strictEqual(keyId, 'k-real');
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, domains: [] });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId });
  assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
});

check('loadSigningConfig also accepts a base64-encoded PEM (no visible BEGIN marker)', () => {
  const { publicKey, privateKey: realPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = realPrivateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY = Buffer.from(pem, 'utf8').toString('base64');
  process.env.BROWSER_POLICY_SIGNING_KEY_ID = 'k-b64';
  const { privateKey, keyId } = ps.loadSigningConfig();
  assert.strictEqual(keyId, 'k-b64');
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, domains: [] });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId });
  assert.strictEqual(ps.verifySnapshot(envelope, publicKey), true);
  delete process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  delete process.env.BROWSER_POLICY_SIGNING_KEY_ID;
});

check('derivePublicKeyInfo never includes any private key material - only keyId/algorithm/public encodings', () => {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const info = ps.derivePublicKeyInfo(privateKey, 'k1');
  const serialized = JSON.stringify(info);
  assert.ok(!serialized.includes('PRIVATE KEY'), 'must never leak PEM private key markers');
  assert.strictEqual(info.keyId, 'k1');
  assert.strictEqual(info.algorithm, 'Ed25519');
  assert.strictEqual(typeof info.publicKeyPem, 'string');
  assert.ok(info.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  assert.strictEqual(Buffer.from(info.publicKeyBase64, 'base64').length, 32, 'a raw Ed25519 public key is always exactly 32 bytes');
});

// ================= policyVersion monotonicity =================

check('assertMonotonicPolicyVersion allows increasing versions and rejects a regression', () => {
  ps._resetMonotonicityTrackerForTests();
  ps.assertMonotonicPolicyVersion(1);
  ps.assertMonotonicPolicyVersion(5);
  ps.assertMonotonicPolicyVersion(5); // same version again is fine (not a regression)
  assert.throws(() => ps.assertMonotonicPolicyVersion(4), /rollback detected/);
  ps.assertMonotonicPolicyVersion(6); // still allowed to proceed forward after a rejected attempt
  ps._resetMonotonicityTrackerForTests();
});

check('signSnapshot itself refuses to sign a policyVersion lower than one already issued this process', () => {
  ps._resetMonotonicityTrackerForTests();
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const higher = ps.buildBrowserPolicySnapshot({ policyVersion: 20, now: NOW, domains: [] });
  ps.signSnapshot(higher, { privateKey, keyId: 'k1' });
  const lower = ps.buildBrowserPolicySnapshot({ policyVersion: 19, now: NOW, domains: [] });
  assert.throws(() => ps.signSnapshot(lower, { privateKey, keyId: 'k1' }), /rollback detected/);
  ps._resetMonotonicityTrackerForTests();
});

check('buildBrowserPolicySnapshot rejects a negative or non-integer policyVersion', () => {
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: -1, now: NOW, domains: [] }));
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: 1.5, now: NOW, domains: [] }));
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: 'five', now: NOW, domains: [] }));
});

console.log(`\n${passed} passed, 0 failed`);
