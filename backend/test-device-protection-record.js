'use strict';

const assert = require('assert');
const { buildDeviceProtectionRecord } = require('./deviceProtectionRecord');

const record = buildDeviceProtectionRecord({
  requestedProfile: 'DEVICE_OWNER',
  health: {
    achievedProtectionProfile: 'HARDENED_ADMIN',
    uninstallProtection: 'ADMIN_GATED',
    adapterId: 'qin.f21pro',
    adapterConfidence: 99,
    oemSkin: 'qin_f21pro',
    oemSkinVersion: '12',
    deviceCodename: 'f21pro',
    buildDisplay: 'Qin test build',
    detectedCapabilities: ['LAUNCHER', 'DEVICE_ADMIN', 'DEVICE_ADMIN'],
    capabilityDetectedAt: 123456789,
  },
});

assert.strictEqual(record.requestedProfile, 'DEVICE_OWNER');
assert.strictEqual(record.achievedProfile, 'HARDENED_ADMIN');
assert.strictEqual(record.protectionSatisfied, false);
assert.strictEqual(record.protectionGap, 1);
assert.strictEqual(record.uninstallProtection, 'ADMIN_GATED');
assert.strictEqual(record.adapterId, 'qin.f21pro');
assert.deepStrictEqual(record.detectedCapabilities, ['LAUNCHER', 'DEVICE_ADMIN']);

const fallback = buildDeviceProtectionRecord({
  requestedProfile: 'NOT_VALID',
  health: {},
});
assert.strictEqual(fallback.requestedProfile, 'HARDENED_ADMIN');
assert.strictEqual(fallback.achievedProfile, 'BASIC');
assert.strictEqual(fallback.protectionSatisfied, false);
assert.strictEqual(fallback.uninstallProtection, 'NONE');

console.log('device protection record tests passed');
