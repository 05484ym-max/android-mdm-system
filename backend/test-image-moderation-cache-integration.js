'use strict';

// Real-PostgreSQL integration test for backend/imageModerationCache.js - the
// module extracted from index.js so this orchestration (exact SHA-256 +
// POLICY_VERSION cache check, then only-if-needed AI moderation call, then
// cache write) is testable without a live HTTP server or a real network
// image fetch. LOCAL_AI_URL/LOCAL_AI_TOKEN are intentionally left unset in
// this test environment, so imageModerator.moderateImage() deterministically
// short-circuits to a "local_ai_not_configured" fail-closed result without
// attempting any network call - which is exactly the "AI was invoked but is
// unavailable" shape this test needs to distinguish a cache hit (which must
// never reach that code at all) from a cache miss (which must).

const assert = require('assert');
const crypto = require('crypto');
const db = require('./db');
const imageModerationCache = require('./imageModerationCache');

function fakeRemote(bytes) {
  const buffer = Buffer.from(bytes);
  return { buffer, mimeType: 'image/png' };
}

(async () => {
  await db.init();
  delete process.env.LOCAL_AI_URL;
  delete process.env.LOCAL_AI_TOKEN;

  // ---- 12. Image SHA cache hit never calls AI ----
  const remoteA = fakeRemote('cache-hit-fixture-' + Date.now());
  const shaA = crypto.createHash('sha256').update(remoteA.buffer).digest('hex');
  const seeded = await db.saveBrowserImageModeration({
    sha256: shaA,
    policyVersion: imageModerationCache.POLICY_VERSION,
    allowed: true,
    reason: 'image_safe_haredi_strict',
    details: { siglipFemale: 0.02 },
    source: 'local_apache_vision_stack',
    mimeType: 'image/png',
    sizeBytes: remoteA.buffer.length,
  });

  const hitDecision = await imageModerationCache.getOrModerateImageDecision(shaA, remoteA);
  assert.strictEqual(hitDecision.allowed, seeded.allowed);
  assert.strictEqual(hitDecision.reason, seeded.reason);
  assert.ok(hitDecision.timing, 'a cache hit must still report timing metadata');
  assert.strictEqual(hitDecision.timing.cacheHit, true, 'must be tagged as a cache hit');
  assert.strictEqual(hitDecision.timing.aiMs, null, 'a cache hit must never record AI latency - AI was never called');

  // ---- 13. Image cache miss calls AI ----
  // With no LOCAL_AI_URL/LOCAL_AI_TOKEN configured, actually reaching
  // imageModerator.moderateImage() deterministically yields
  // "local_ai_not_configured" - a shape only that call produces. Getting
  // this exact reason back proves the miss path invoked it.
  const remoteB = fakeRemote('cache-miss-fixture-' + Date.now() + Math.random());
  const shaB = crypto.createHash('sha256').update(remoteB.buffer).digest('hex');
  assert.strictEqual(
    await db.getBrowserImageModeration(shaB, imageModerationCache.POLICY_VERSION),
    null,
    'fixture must start with no cached row',
  );

  const missDecision = await imageModerationCache.getOrModerateImageDecision(shaB, remoteB);
  assert.strictEqual(missDecision.allowed, false);
  assert.strictEqual(missDecision.reason, 'local_ai_not_configured', 'a cache miss must actually invoke AI moderation');
  assert.ok(missDecision.timing, 'a cache miss must report timing metadata');
  assert.strictEqual(missDecision.timing.cacheHit, false);
  assert.strictEqual(typeof missDecision.timing.aiMs, 'number', 'AI latency must be measured on a real call');

  // ---- 14. Transient AI failure is blocked but not persisted ----
  assert.strictEqual(
    imageModerationCache.isCacheableDecision(missDecision),
    false,
    '"local_ai_not_configured" is a transient infrastructure condition, not a fact about the image - must never be cacheable',
  );
  assert.strictEqual(
    await db.getBrowserImageModeration(shaB, imageModerationCache.POLICY_VERSION),
    null,
    'a transient AI failure must never be persisted to the permanent moderation cache',
  );

  // A second call for the same unseen image, still with no LOCAL_AI
  // configured, must independently re-attempt moderation (not have been
  // wrongly cached as blocked forever) and reach the exact same fail-closed
  // outcome again.
  const secondMissDecision = await imageModerationCache.getOrModerateImageDecision(shaB, remoteB);
  assert.strictEqual(secondMissDecision.allowed, false);
  assert.strictEqual(secondMissDecision.reason, 'local_ai_not_configured');
  assert.strictEqual(secondMissDecision.timing.cacheHit, false, 'a non-cacheable outcome must be re-attempted, never short-circuited from a bogus cache entry');

  console.log('Image moderation cache orchestration (real PostgreSQL): all tests passed');
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
