'use strict';

const assert = require('assert');
const {
  normalizeReleaseControl,
  rolloutBucket,
  isDeviceEligibleForRelease,
} = require('./releaseRollout');

assert.deepStrictEqual(normalizeReleaseControl('TEST', 83), {
  status: 'TEST', rolloutPercentage: 0,
});
assert.deepStrictEqual(normalizeReleaseControl('stable', 0), {
  status: 'STABLE', rolloutPercentage: 100,
});
assert.deepStrictEqual(normalizeReleaseControl('HALTED', 100), {
  status: 'HALTED', rolloutPercentage: 0,
});
assert.deepStrictEqual(normalizeReleaseControl('ROLLOUT', 25), {
  status: 'ROLLOUT', rolloutPercentage: 25,
});
assert.throws(() => normalizeReleaseControl('ROLLOUT', 0));
assert.throws(() => normalizeReleaseControl('ROLLOUT', 100));
assert.throws(() => normalizeReleaseControl('BOGUS', 10));

const bucket = rolloutBucket('1234567890', 200);
assert(Number.isInteger(bucket) && bucket >= 0 && bucket < 100);
assert.strictEqual(bucket, rolloutBucket('1234567890', 200));

const base = { versionCode: 200, releaseStatus: 'TEST', rolloutPercentage: 0 };
assert.strictEqual(isDeviceEligibleForRelease(base, { deviceId: '1', isTestDevice: false }), false);
assert.strictEqual(isDeviceEligibleForRelease(base, { deviceId: '1', isTestDevice: true }), true);
assert.strictEqual(isDeviceEligibleForRelease({ ...base, releaseStatus: 'HALTED' }, { deviceId: '1', isTestDevice: true }), false);
assert.strictEqual(isDeviceEligibleForRelease({ ...base, releaseStatus: 'STABLE', rolloutPercentage: 100 }, { deviceId: '1' }), true);

for (let i = 0; i < 100; i++) {
  const id = `device-${i}`;
  const release = { versionCode: 201, releaseStatus: 'ROLLOUT', rolloutPercentage: 30 };
  assert.strictEqual(
    isDeviceEligibleForRelease(release, { deviceId: id }),
    rolloutBucket(id, 201) < 30,
  );
}

console.log('release rollout tests passed');
