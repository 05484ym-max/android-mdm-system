'use strict';

const assert = require('assert');
const { validateHealthPayload } = require('./deviceHealth');

function expectOk(body) {
  const result = validateHealthPayload(body);
  assert.strictEqual(result.error, undefined, result.error || 'expected valid payload');
  return result.value;
}

function expectError(body, fragment) {
  const result = validateHealthPayload(body);
  assert.ok(result.error, 'expected validation error');
  assert.ok(result.error.includes(fragment), `expected "${result.error}" to include "${fragment}"`);
}

const valid = expectOk({
  adapterId: 'qin.f21pro',
  adapterConfidence: 99,
  oemSkin: 'qin_f21pro',
  oemSkinVersion: 'custom-build',
  deviceCodename: 'f21pro',
  buildDisplay: 'Qin F21 Pro test build',
  capabilityDetectedAt: Date.now(),
  detectedCapabilities: [
    'LAUNCHER',
    'DEFAULT_HOME',
    'ACCESSIBILITY',
    'DEVICE_ADMIN',
  ],
  achievedProtectionProfile: 'HARDENED_ADMIN',
  uninstallProtection: 'ADMIN_GATED',
});

assert.deepStrictEqual(valid.detectedCapabilities, [
  'LAUNCHER',
  'DEFAULT_HOME',
  'ACCESSIBILITY',
  'DEVICE_ADMIN',
]);
assert.strictEqual(valid.achievedProtectionProfile, 'HARDENED_ADMIN');
assert.strictEqual(valid.uninstallProtection, 'ADMIN_GATED');

const deduped = expectOk({ detectedCapabilities: ['LAUNCHER', 'LAUNCHER'] });
assert.deepStrictEqual(deduped.detectedCapabilities, ['LAUNCHER']);

expectError({ adapterConfidence: 101 }, 'adapterConfidence');
expectError({ detectedCapabilities: 'LAUNCHER' }, 'detectedCapabilities');
expectError({ detectedCapabilities: ['launcher'] }, 'invalid capability token');
expectError({ capabilityDetectedAt: 0 }, 'capabilityDetectedAt');
expectError({ achievedProtectionProfile: 'MAGICAL' }, 'achievedProtectionProfile');
expectError({ uninstallProtection: 'UNREMOVABLE' }, 'uninstallProtection');

console.log('device capability validation tests passed');
