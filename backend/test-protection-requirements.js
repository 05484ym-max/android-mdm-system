'use strict';

const assert = require('assert');
const { describeProtectionRequirements } = require('./protectionRequirements');

function req(requestedProfile, achievedProfile, detectedCapabilities = []) {
  return describeProtectionRequirements({ requestedProfile, achievedProfile, detectedCapabilities });
}

assert.deepStrictEqual(
  req('HARDENED', 'BASIC', ['DEFAULT_HOME']).missingCapabilities,
  ['ACCESSIBILITY'],
);
assert.deepStrictEqual(
  req('HARDENED', 'BASIC', []).missingCapabilities,
  ['DEFAULT_HOME', 'ACCESSIBILITY'],
);
assert.deepStrictEqual(
  req('HARDENED_ADMIN', 'HARDENED', ['DEFAULT_HOME', 'ACCESSIBILITY']).missingCapabilities,
  ['DEVICE_ADMIN'],
);
assert.deepStrictEqual(
  req('DEVICE_OWNER', 'HARDENED_ADMIN', ['DEVICE_ADMIN']).missingCapabilities,
  ['DEVICE_OWNER'],
);
assert.strictEqual(
  req('DEVICE_OWNER', 'HARDENED_ADMIN', ['DEVICE_ADMIN']).requiresReprovisioning,
  true,
);
assert.deepStrictEqual(
  req('SYSTEM_LEVEL', 'DEVICE_OWNER', ['DEVICE_OWNER']).missingCapabilities,
  ['PRIV_APP'],
);
assert.strictEqual(
  req('SYSTEM_LEVEL', 'DEVICE_OWNER', ['DEVICE_OWNER']).requiresSystemIntegration,
  true,
);

// A stronger achieved state satisfies the request even if the direct target
// capability is not in the report. Never display fake missing work in that case.
assert.deepStrictEqual(
  req('HARDENED', 'DEVICE_OWNER', ['DEVICE_OWNER']).missingCapabilities,
  [],
);
assert.strictEqual(req('HARDENED', 'DEVICE_OWNER', ['DEVICE_OWNER']).satisfied, true);

// Unknown/untrusted capability strings are ignored.
assert.deepStrictEqual(
  req('HARDENED', 'BASIC', ['DEFAULT_HOME', 'MADE_UP']).missingCapabilities,
  ['ACCESSIBILITY'],
);

console.log('protection requirement tests passed');
