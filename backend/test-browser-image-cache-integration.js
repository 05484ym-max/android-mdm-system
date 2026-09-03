'use strict';

const assert = require('assert');
const crypto = require('crypto');
const db = require('./db');

(async () => {
  await db.init();

  const hash = crypto.createHash('sha256').update('image-a').digest('hex');
  const policy = 'HAREDI_STRICT_V1';

  assert.strictEqual(await db.getBrowserImageModeration(hash, policy), null);

  const saved = await db.saveBrowserImageModeration({
    sha256: hash,
    policyVersion: policy,
    allowed: false,
    reason: 'female_detected',
    details: { femaleScore: 0.98 },
    source: 'google_vision',
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
  });

  assert.strictEqual(saved.allowed, false);
  assert.strictEqual(saved.reason, 'female_detected');
  assert.strictEqual(saved.details.femaleScore, 0.98);

  const read = await db.getBrowserImageModeration(hash, policy);
  assert.strictEqual(read.sha256, hash);
  assert.strictEqual(read.policyVersion, policy);
  assert.strictEqual(read.mimeType, 'image/jpeg');
  assert.strictEqual(read.sizeBytes, 1234);

  assert.strictEqual(
    await db.getBrowserImageModeration(hash, 'HAREDI_STRICT_V2'),
    null,
    'policy version must invalidate old image decisions',
  );

  console.log('Browser image moderation cache integration: passed');
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
