// Pure (DB-free, network-free) unit tests for policySigning.js - Phase 2.4
// (+ the Phase 2.4 correction: globalDomains/deviceOverrides shape,
// equal-policyVersion acceptance). Ephemeral Ed25519 keypairs are
// generated fresh at runtime for every test run (crypto.generateKeyPairSync)
// - no key material is ever committed to this repo or fixture file. Run
// directly with `node test-policy-signing.js`.
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
    globalDomains: [{ domain: 'example.com', decision: 'ALLOW', allowSubdomains: false }],
    deviceOverrides: [],
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
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, globalDomains: [], deviceOverrides: [] });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });
  assert.strictEqual(ps.verifySnapshot(envelope, wrongPublicKey), false);
});

// ================= tampered payload rejected =================

check('a tampered globalDomains payload (any field) fails verification', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({
    policyVersion: 5,
    now: NOW,
    globalDomains: [{ domain: 'a.com', decision: 'ALLOW', allowSubdomains: false }],
    deviceOverrides: [],
  });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });

  const tamperedDomain = JSON.parse(JSON.stringify(envelope));
  tamperedDomain.payload.globalDomains[0].decision = 'BLOCK';
  assert.strictEqual(ps.verifySnapshot(tamperedDomain, publicKey), false);

  const addedDomain = JSON.parse(JSON.stringify(envelope));
  addedDomain.payload.globalDomains.push({ domain: 'evil.com', decision: 'ALLOW', allowSubdomains: true });
  assert.strictEqual(ps.verifySnapshot(addedDomain, publicKey), false);

  const tamperedExpiry = JSON.parse(JSON.stringify(envelope));
  tamperedExpiry.payload.expiresAt = new Date(NOW + ps.SNAPSHOT_TTL_MS * 100).toISOString();
  assert.strictEqual(ps.verifySnapshot(tamperedExpiry, publicKey), false);
});

check('a tampered deviceOverrides payload fails verification (adding, changing, or removing an override)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({
    policyVersion: 5,
    now: NOW,
    globalDomains: [{ domain: 'a.com', decision: 'BLOCK', allowSubdomains: false }],
    deviceOverrides: [{ domain: 'a.com', decision: 'ALLOW' }],
  });
  const envelope = ps.signSnapshot(payload, { privateKey, keyId: 'k1' });

  const changedDecision = JSON.parse(JSON.stringify(envelope));
  changedDecision.payload.deviceOverrides[0].decision = 'BLOCK';
  assert.strictEqual(ps.verifySnapshot(changedDecision, publicKey), false);

  const addedOverride = JSON.parse(JSON.stringify(envelope));
  addedOverride.payload.deviceOverrides.push({ domain: 'injected-by-attacker.com', decision: 'ALLOW' });
  assert.strictEqual(ps.verifySnapshot(addedOverride, publicKey), false);

  const removedOverride = JSON.parse(JSON.stringify(envelope));
  removedOverride.payload.deviceOverrides = [];
  assert.strictEqual(ps.verifySnapshot(removedOverride, publicKey), false);
});

// ================= tampered policyVersion rejected =================

check('a tampered policyVersion specifically fails verification (never silently accepted)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 10, now: NOW, globalDomains: [], deviceOverrides: [] });
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
  const a = { policyVersion: 1, generatedAt: 'x', expiresAt: 'y', globalDomains: [], deviceOverrides: [] };
  const b = { expiresAt: 'y', deviceOverrides: [], globalDomains: [], policyVersion: 1, generatedAt: 'x' };
  assert.strictEqual(ps.canonicalize(a), ps.canonicalize(b));
});

check('canonicalize() sorts keys recursively, including inside array elements', () => {
  const a = { globalDomains: [{ decision: 'ALLOW', domain: 'x.com', allowSubdomains: false }] };
  const b = { globalDomains: [{ domain: 'x.com', allowSubdomains: false, decision: 'ALLOW' }] };
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
    globalDomains: [
      { domain: 'b.com', decision: 'BLOCK', allowSubdomains: false },
      { domain: 'a.com', decision: 'ALLOW', allowSubdomains: true },
    ],
    deviceOverrides: [
      { domain: 'd.com', decision: 'BLOCK' },
      { domain: 'c.com', decision: 'ALLOW' },
    ],
  });
  const bytes1 = ps.canonicalPayloadBytes(buildOnce());
  const bytes2 = ps.canonicalPayloadBytes(buildOnce());
  assert.ok(bytes1.equals(bytes2));
});

// ================= domain ordering does not change the signature =================

check('globalDomains ordering in the INPUT does not change the resulting canonical bytes/signature', () => {
  const domainsA = [
    { domain: 'zzz.com', decision: 'ALLOW', allowSubdomains: false },
    { domain: 'aaa.com', decision: 'BLOCK', allowSubdomains: true },
    { domain: 'mmm.com', decision: 'ALLOW', allowSubdomains: false },
  ];
  const domainsB = [domainsA[2], domainsA[0], domainsA[1]]; // same set, different input order
  const payloadA = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, globalDomains: domainsA, deviceOverrides: [] });
  const payloadB = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, globalDomains: domainsB, deviceOverrides: [] });
  assert.ok(ps.canonicalPayloadBytes(payloadA).equals(ps.canonicalPayloadBytes(payloadB)));
  // And the output order itself is normalized (sorted), not just coincidentally equal.
  assert.deepStrictEqual(payloadA.globalDomains.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
  assert.deepStrictEqual(payloadB.globalDomains.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
});

check('deviceOverrides ordering in the INPUT does not change the resulting canonical bytes/signature', () => {
  const overridesA = [
    { domain: 'zzz.com', decision: 'ALLOW' },
    { domain: 'aaa.com', decision: 'BLOCK' },
    { domain: 'mmm.com', decision: 'ALLOW' },
  ];
  const overridesB = [overridesA[1], overridesA[2], overridesA[0]];
  const payloadA = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, globalDomains: [], deviceOverrides: overridesA });
  const payloadB = ps.buildBrowserPolicySnapshot({ policyVersion: 2, now: NOW, globalDomains: [], deviceOverrides: overridesB });
  assert.ok(ps.canonicalPayloadBytes(payloadA).equals(ps.canonicalPayloadBytes(payloadB)));
  assert.deepStrictEqual(payloadA.deviceOverrides.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
  assert.deepStrictEqual(payloadB.deviceOverrides.map(d => d.domain), ['aaa.com', 'mmm.com', 'zzz.com']);
});

check('deviceOverrides entries never carry an allowSubdomains field (schema has no such column - exact match only)', () => {
  const payload = ps.buildBrowserPolicySnapshot({
    policyVersion: 1,
    now: NOW,
    globalDomains: [],
    deviceOverrides: [{ domain: 'a.com', decision: 'ALLOW', allowSubdomains: true }], // even if a caller mistakenly passes one
  });
  assert.deepStrictEqual(payload.deviceOverrides, [{ domain: 'a.com', decision: 'ALLOW' }]);
  assert.strictEqual('allowSubdomains' in payload.deviceOverrides[0], false);
});

// ================= expired snapshot =================

check('isSnapshotExpired is false right after generation and at the exact expiry instant is true', () => {
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, globalDomains: [], deviceOverrides: [] });
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW), false);
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW + ps.SNAPSHOT_TTL_MS - 1), false);
  assert.strictEqual(ps.isSnapshotExpired(payload, NOW + ps.SNAPSHOT_TTL_MS), true);
});

check('isSnapshotExpired is true long after expiry', () => {
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, globalDomains: [], deviceOverrides: [] });
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
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, globalDomains: [], deviceOverrides: [] });
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
  const payload = ps.buildBrowserPolicySnapshot({ policyVersion: 1, now: NOW, globalDomains: [], deviceOverrides: [] });
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

// ================= policyVersion monotonicity (equal MUST be allowed) =================

check('assertMonotonicPolicyVersion allows increasing AND equal versions, and rejects only a strict regression', () => {
  ps._resetMonotonicityTrackerForTests();
  ps.assertMonotonicPolicyVersion(1);
  ps.assertMonotonicPolicyVersion(5);
  // Equal MUST succeed - a freshly-generated snapshot with an unchanged
  // policyVersion (just renewed generatedAt/expiresAt) is the normal,
  // expected case on every re-fetch with no policy mutation in between -
  // see docs/server-api-contract.md's "policyVersion handling".
  ps.assertMonotonicPolicyVersion(5);
  assert.throws(() => ps.assertMonotonicPolicyVersion(4), /rollback detected/);
  ps.assertMonotonicPolicyVersion(6); // still allowed to proceed forward after a rejected attempt
  ps._resetMonotonicityTrackerForTests();
});

check('signSnapshot signs the SAME policyVersion again without error (equal is not a rollback)', () => {
  ps._resetMonotonicityTrackerForTests();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const first = ps.buildBrowserPolicySnapshot({ policyVersion: 20, now: NOW, globalDomains: [], deviceOverrides: [] });
  const firstEnvelope = ps.signSnapshot(first, { privateKey, keyId: 'k1' });
  assert.strictEqual(ps.verifySnapshot(firstEnvelope, publicKey), true);

  // A later moment, same policyVersion (no policy change happened) -
  // generatedAt/expiresAt renew, and this must succeed, not throw.
  const second = ps.buildBrowserPolicySnapshot({ policyVersion: 20, now: NOW + 60_000, globalDomains: [], deviceOverrides: [] });
  const secondEnvelope = ps.signSnapshot(second, { privateKey, keyId: 'k1' });
  assert.strictEqual(ps.verifySnapshot(secondEnvelope, publicKey), true);
  assert.strictEqual(second.policyVersion, first.policyVersion);
  assert.notStrictEqual(second.generatedAt, first.generatedAt, 'generatedAt must still renew even though policyVersion is unchanged');
  ps._resetMonotonicityTrackerForTests();
});

check('signSnapshot itself refuses to sign a policyVersion lower (never equal) than one already issued this process', () => {
  ps._resetMonotonicityTrackerForTests();
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const higher = ps.buildBrowserPolicySnapshot({ policyVersion: 20, now: NOW, globalDomains: [], deviceOverrides: [] });
  ps.signSnapshot(higher, { privateKey, keyId: 'k1' });
  const lower = ps.buildBrowserPolicySnapshot({ policyVersion: 19, now: NOW, globalDomains: [], deviceOverrides: [] });
  assert.throws(() => ps.signSnapshot(lower, { privateKey, keyId: 'k1' }), /rollback detected/);
  ps._resetMonotonicityTrackerForTests();
});

check('buildBrowserPolicySnapshot rejects a negative or non-integer policyVersion', () => {
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: -1, now: NOW, globalDomains: [], deviceOverrides: [] }));
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: 1.5, now: NOW, globalDomains: [], deviceOverrides: [] }));
  assert.throws(() => ps.buildBrowserPolicySnapshot({ policyVersion: 'five', now: NOW, globalDomains: [], deviceOverrides: [] }));
});

console.log(`\n${passed} passed, 0 failed`);
