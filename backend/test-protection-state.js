'use strict';

const assert = require('assert');
const {
  normalizeRequestedProfile,
  assessProtectionState,
} = require('./protectionState');

assert.strictEqual(normalizeRequestedProfile('DEVICE_OWNER'), 'DEVICE_OWNER');
assert.strictEqual(normalizeRequestedProfile('INVALID'), 'HARDENED_ADMIN');

assert.deepStrictEqual(
  assessProtectionState('HARDENED_ADMIN', 'HARDENED_ADMIN'),
  {
    requestedProfile: 'HARDENED_ADMIN',
    achievedProfile: 'HARDENED_ADMIN',
    satisfied: true,
    gap: 0,
  },
);

assert.deepStrictEqual(
  assessProtectionState('DEVICE_OWNER', 'HARDENED_ADMIN'),
  {
    requestedProfile: 'DEVICE_OWNER',
    achievedProfile: 'HARDENED_ADMIN',
    satisfied: false,
    gap: 1,
  },
);

assert.deepStrictEqual(
  assessProtectionState('HARDENED_ADMIN', 'SYSTEM_LEVEL'),
  {
    requestedProfile: 'HARDENED_ADMIN',
    achievedProfile: 'SYSTEM_LEVEL',
    satisfied: true,
    gap: 0,
  },
);

assert.strictEqual(
  assessProtectionState('HARDENED_ADMIN', 'UNKNOWN').achievedProfile,
  'BASIC',
);

console.log('protection state tests passed');
