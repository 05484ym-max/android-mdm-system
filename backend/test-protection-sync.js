'use strict';

const assert = require('assert');
const {
  hasProtectionReport,
  persistProtectionFromSync,
} = require('./protectionSync');

assert.strictEqual(hasProtectionReport(null), false);
assert.strictEqual(hasProtectionReport({ model: 'old-device' }), false);
assert.strictEqual(hasProtectionReport({ adapterId: 'qin.f21pro' }), true);
assert.strictEqual(hasProtectionReport({ detectedCapabilities: [] }), true);

(async () => {
  const calls = [];
  const fakePersistence = {
    async recordDeviceProtection(deviceId, health) {
      calls.push({ deviceId, health });
      return { deviceId, achievedProfile: health.achievedProtectionProfile };
    },
  };

  const legacy = await persistProtectionFromSync(
    '1001',
    { model: 'legacy' },
    fakePersistence,
  );
  assert.strictEqual(legacy, null);
  assert.strictEqual(calls.length, 0);

  const health = {
    adapterId: 'qin.f21pro',
    achievedProtectionProfile: 'HARDENED_ADMIN',
    uninstallProtection: 'ADMIN_GATED',
    detectedCapabilities: ['LAUNCHER', 'ACCESSIBILITY', 'DEVICE_ADMIN'],
  };
  const saved = await persistProtectionFromSync('1002', health, fakePersistence);
  assert.strictEqual(saved.deviceId, '1002');
  assert.strictEqual(saved.achievedProfile, 'HARDENED_ADMIN');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], { deviceId: '1002', health });

  console.log('protection sync tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
