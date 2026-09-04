'use strict';

// Orchestrates the HAREDI_STRICT image moderation fast path: exact
// SHA-256 + POLICY_VERSION cache lookup, single-flight coalescing of
// concurrent misses on the same image, and only then a call into
// imageModerator (the Node-owned policy decision) for a genuinely unseen
// image. Pulled out of index.js so this ordering - which is exactly what
// Phase B of the strict-fast-allowlist work requires - is directly
// unit/integration-testable against a real database without needing a live
// HTTP server or a real network image fetch (the SSRF protections in
// safeRemoteImage.js correctly make faking a "real" remote image
// impossible to test against safely, so the fetch itself stays covered by
// its own existing tests and this module is tested with an in-memory
// buffer instead).

const db = require('./db');
const imageModerator = require('./imageModerator');
const { SingleFlight } = require('./singleFlight');

const POLICY_VERSION = imageModerator.POLICY_VERSION;
const singleFlight = new SingleFlight();

// Single source of truth for which reasons represent a stable fact about the
// image itself (a real HAREDI_STRICT decision) versus a transient
// infrastructure condition (unreachable/warming/unavailable/error/timeout/
// malformed response/schema mismatch/5xx). Only the former may ever be
// written to the permanent moderation cache - a transient outage must never
// be persisted as if it were a fact about the image, or a temporary AI
// service failure could permanently misclassify images once it recovers.
// This set lives in imageModerator.js (the policy owner) so it can never
// drift out of sync with the reasons that module actually produces.
function isCacheableDecision(result) {
  return imageModerator.CACHEABLE_DECISION_REASONS.has(result.reason);
}

/**
 * sha256Hex must already be computed by the caller (crypto.createHash over
 * the fetched bytes). remote is { buffer, mimeType } as produced by
 * safeRemoteImage.fetchSafeImage(). Returns the decision plus a
 * "timing.cacheHit"/"timing.aiMs" field for observability only - it never
 * influences the decision and is never persisted to the DB.
 */
async function getOrModerateImageDecision(sha256Hex, remote) {
  const cached = await db.getBrowserImageModeration(sha256Hex, POLICY_VERSION);
  if (cached) return { ...cached, timing: { cacheHit: true, aiMs: null } };

  return singleFlight.run(sha256Hex, async () => {
    // Re-check the database after winning the in-memory race in case another
    // process/instance populated the shared cache between the first read and
    // this point.
    const secondRead = await db.getBrowserImageModeration(sha256Hex, POLICY_VERSION);
    if (secondRead) return { ...secondRead, timing: { cacheHit: true, aiMs: null } };

    const aiStartedAt = process.hrtime.bigint();
    const moderated = await imageModerator.moderateImage(remote.buffer);
    const aiMs = Number(process.hrtime.bigint() - aiStartedAt) / 1e6;

    let decision = {
      sha256: sha256Hex,
      policyVersion: POLICY_VERSION,
      allowed: moderated.allowed === true,
      reason: moderated.reason,
      details: moderated.details || {},
      source: moderated.source || 'local_siglip2_nudenet',
      mimeType: remote.mimeType,
      sizeBytes: remote.buffer.length,
    };

    if (isCacheableDecision(moderated)) {
      decision = await db.saveBrowserImageModeration(decision);
    }
    return { ...decision, timing: { cacheHit: false, aiMs } };
  });
}

module.exports = {
  POLICY_VERSION,
  isCacheableDecision,
  getOrModerateImageDecision,
  singleFlight,
};
