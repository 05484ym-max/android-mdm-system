// Asymmetric signing for the browser-policy offline snapshot (Phase 2.4).
// Ed25519 only - no HMAC, no shared secret ever touches a device. The
// private key lives server-side only (loaded from environment/secret
// configuration, see loadSigningConfig()); only the public key and a
// keyId are ever meant to reach a device, and only in a later phase (this
// phase deliberately does not implement or document Android-side
// verification code - see docs/app-update-check.md-style honesty: this
// documents the CONTRACT, not a client implementation).
//
// Why Ed25519: Node's `crypto` module has had stable, native Ed25519
// support (sign/verify/generateKeyPairSync, no external dependency) since
// Node 12 - this deployment runs Node 22, so there is no compatibility
// reason to prefer RSA/ECDSA. Ed25519 signatures are fixed-size (64 bytes),
// deterministic (no per-signature randomness/nonce reuse risk the way
// ECDSA has), and fast to verify - all directly useful for a device
// verifying a cached snapshot offline.
'use strict';

const crypto = require('crypto');

const ALGORITHM = 'Ed25519';

// How long a freshly-signed snapshot is valid for. Same order of magnitude
// as the existing per-decision ALLOW/BLOCK cache TTL in browserPolicy.js
// (DECIDED_TTL_MS, 24h) but a deliberately separate constant - one governs
// a single /browser/check response, this one governs a whole offline
// snapshot, and they should be free to diverge later without one edit
// accidentally changing the other's meaning.
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Loads and validates the Ed25519 signing key from environment/secret
 * configuration. Never logs the key material - only ever logs (via the
 * error message the caller may print) that it's missing or malformed.
 *
 * BROWSER_POLICY_SIGNING_PRIVATE_KEY: a PKCS8 PEM-encoded Ed25519 private
 * key. Real newlines are fine; a single-line env var with literal `\n`
 * two-character escape sequences (the common shape once a multi-line PEM
 * goes through a platform that only supports single-line env vars) is
 * unescaped automatically. A base64-encoded PEM (no "BEGIN PRIVATE KEY"
 * marker visible) is also accepted, decoded before parsing - covers a
 * secret manager that stores raw bytes rather than text.
 * BROWSER_POLICY_SIGNING_KEY_ID: an opaque string identifying this key,
 * so a future key rotation can coexist with clients still trusting an
 * older keyId. Required whenever the private key is configured - a key
 * with no id can never be safely rotated later.
 *
 * Throws (never returns a partial/fallback result) if either variable is
 * missing, the PEM fails to parse, or the key is not actually Ed25519 -
 * every caller in this codebase lets that propagate to a 500 rather than
 * catching it into some other "policy", per the fail-closed requirement:
 * a missing/malformed signing key must never result in an unsigned
 * snapshot being returned as if it were trusted.
 */
function loadSigningConfig() {
  const rawKey = process.env.BROWSER_POLICY_SIGNING_PRIVATE_KEY;
  const keyId = process.env.BROWSER_POLICY_SIGNING_KEY_ID;
  if (!rawKey || !keyId) {
    throw new Error(
      'browser policy signing is not configured - both ' +
      'BROWSER_POLICY_SIGNING_PRIVATE_KEY and BROWSER_POLICY_SIGNING_KEY_ID ' +
      'must be set',
    );
  }
  const pem = rawKey.includes('BEGIN PRIVATE KEY')
    ? rawKey.replace(/\\n/g, '\n')
    : Buffer.from(rawKey, 'base64').toString('utf8');

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new Error('browser policy signing private key is malformed (not a parseable PEM private key)');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `browser policy signing key must be Ed25519, got "${privateKey.asymmetricKeyType}"`,
    );
  }
  return { privateKey, keyId };
}

/** Derives the public key + portable encodings from a loaded private key -
 * exactly what's safe to expose (via the admin-only signing-key endpoint
 * today; to a device once a later phase decides to). Never touches the
 * private key material itself beyond deriving the public counterpart. */
function derivePublicKeyInfo(privateKey, keyId) {
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' }); // { kty, crv, x } - x is the raw 32-byte key, base64url
  return {
    keyId,
    algorithm: ALGORITHM,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    // Raw 32-byte Ed25519 public key, standard (not url-safe) base64 - the
    // form most JVM/Android crypto libraries (java.security, Tink,
    // BouncyCastle) expect for an Ed25519 public key, rather than needing
    // to parse an SPKI/DER wrapper first.
    publicKeyBase64: Buffer.from(jwk.x, 'base64url').toString('base64'),
  };
}

/**
 * Deterministic ("canonical") JSON serialization: object keys are sorted
 * recursively so the exact same logical value always produces the exact
 * same bytes, regardless of the key insertion order the caller happened
 * to build the object in. Array order is preserved as given - it is NOT
 * re-sorted here, because array order can be semantically meaningful in
 * general; buildBrowserPolicySnapshot (below) is what guarantees the
 * *domains* array specifically is always constructed in a fixed order
 * (sorted by domain) before it ever reaches this function, which is what
 * actually makes "the same policy state always signs identically" true
 * end to end - see that function's own doc.
 *
 * No whitespace, no trailing commas, no undefined (throws instead of
 * silently emitting the literal `undefined` into the byte stream, which
 * plain JSON.stringify(undefined) would otherwise do inside an object
 * value's position and corrupt the canonical form).
 */
function canonicalize(value) {
  if (value === undefined) {
    throw new Error('cannot canonicalize undefined - every signed field must have an explicit value');
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

/** The exact bytes a signature covers - UTF-8 encoding of the canonical
 * JSON form. Exported so tests (and, if ever needed, an offline debugging
 * tool) can reproduce precisely what was signed without re-deriving the
 * canonicalization rules themselves. */
function canonicalPayloadBytes(payload) {
  return Buffer.from(canonicalize(payload), 'utf8');
}

/**
 * Builds the canonical snapshot payload from already-fetched inputs - pure
 * and DB-free on purpose, so "does this always serialize/sign identically
 * regardless of incidental input order" is testable with a plain array,
 * no database involved (see test-policy-signing.js's domain-ordering
 * tests). `domains` may be given in ANY order (e.g. whatever order a
 * database happened to return rows in) - they are always re-sorted by
 * `domain` here before being placed in the payload, which is what makes
 * the resulting signature independent of read order.
 *
 * Only the fields genuinely needed to reproduce browserPolicy.js's
 * `domainCovers` matching offline are included per domain (domain,
 * decision, allowSubdomains) - admin-only metadata (category, riskScore,
 * reason, decisionVersion, ...) is deliberately left out of the signed
 * surface, per "no unsigned fields that affect policy behavior" read the
 * other way around too: no signed fields that DON'T affect policy
 * behavior either, keeping the payload minimal and its meaning
 * unambiguous.
 */
function buildBrowserPolicySnapshot({ policyVersion, domains, now = Date.now() }) {
  if (!Number.isInteger(policyVersion) || policyVersion < 0) {
    throw new Error('policyVersion must be a non-negative integer');
  }
  const sortedDomains = [...domains]
    .map(d => ({
      domain: String(d.domain),
      decision: d.decision,
      allowSubdomains: Boolean(d.allowSubdomains),
    }))
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  return {
    policyVersion,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SNAPSHOT_TTL_MS).toISOString(),
    domains: sortedDomains,
  };
}

function isSnapshotExpired(snapshot, now = Date.now()) {
  return now >= Date.parse(snapshot.expiresAt);
}

// Per-process high-water mark. Guards against a single process ever
// signing and issuing a LOWER policyVersion than one it already issued -
// a real, if narrow, safety net: policyVersion itself is persisted in
// Postgres and already provably monotonic across restarts (verified in
// Phase 2.3's restart/persistence suite), so this specifically catches an
// anomalous read within one process's own lifetime (e.g. a lagging read
// replica), not a cross-restart guarantee - see docs/server-api-contract.md
// for the precise scope of this claim. Reset on process restart is
// intentional and safe: a fresh process re-derives its baseline from
// Postgres, which is itself never lower than what was last durably
// committed.
let highestIssuedPolicyVersion = 0;

/** Throws (never silently clamps or drops the request) if `policyVersion`
 * would regress what this process already issued. Callers must let this
 * propagate to a 500, exactly like a signing failure - see index.js's
 * policy-snapshot route. */
function assertMonotonicPolicyVersion(policyVersion) {
  if (policyVersion < highestIssuedPolicyVersion) {
    throw new Error(
      `policyVersion rollback detected: attempted to issue ${policyVersion}, ` +
      `already issued ${highestIssuedPolicyVersion} this process`,
    );
  }
  highestIssuedPolicyVersion = Math.max(highestIssuedPolicyVersion, policyVersion);
}

/** Test-only escape hatch to reset the monotonicity tracker between
 * independent test cases - never called from production code. */
function _resetMonotonicityTrackerForTests() {
  highestIssuedPolicyVersion = 0;
}

/**
 * Signs a snapshot payload (already built by buildBrowserPolicySnapshot).
 * Runs the monotonicity guard first - a rollback attempt never reaches
 * the actual signing step. Returns the full envelope the device receives:
 * the payload itself, plus keyId/algorithm (unsigned metadata used only
 * to pick which public key to verify with - see this module's top-of-file
 * doc for why that's safe: tampering with either can only ever make
 * verification fail, never make a forged payload verify successfully)
 * and the base64 signature over the exact canonical bytes of `payload`.
 */
function signSnapshot(payload, { privateKey, keyId }) {
  assertMonotonicPolicyVersion(payload.policyVersion);
  const bytes = canonicalPayloadBytes(payload);
  const signature = crypto.sign(null, bytes, privateKey).toString('base64');
  return { payload, keyId, algorithm: ALGORITHM, signature };
}

/** Verifies a signed envelope against a given public key. Returns a
 * boolean only - never throws for a bad signature (a malformed envelope
 * shape, e.g. a missing field, still throws, since that's a programming
 * error in the caller, not a "signature didn't match" outcome). Provided
 * mainly for the test suite's own round-trip proof; real device-side
 * verification is explicitly out of scope for this phase. */
function verifySnapshot(envelope, publicKey) {
  const bytes = canonicalPayloadBytes(envelope.payload);
  return crypto.verify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64'));
}

module.exports = {
  ALGORITHM,
  SNAPSHOT_TTL_MS,
  loadSigningConfig,
  derivePublicKeyInfo,
  canonicalize,
  canonicalPayloadBytes,
  buildBrowserPolicySnapshot,
  isSnapshotExpired,
  assertMonotonicPolicyVersion,
  _resetMonotonicityTrackerForTests,
  signSnapshot,
  verifySnapshot,
};
