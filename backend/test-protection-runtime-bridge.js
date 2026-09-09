'use strict';

const assert = require('assert');
const { installProtectionRuntimeBridge } = require('./protectionRuntimeBridge');

async function main() {
  const calls = [];
  const db = {
    async recordDeviceHealth(deviceId, health) {
      calls.push(['recordHealth', deviceId, health]);
      return { ok: true };
    },
    async listDeviceHealth() {
      return [{ deviceId: 'd1', model: 'Qin F21 Pro' }, { deviceId: 'd2', model: 'Galaxy' }];
    },
    async getDeviceHealth(deviceId) {
      return deviceId === 'missing' ? null : { deviceId, model: 'test' };
    },
  };
  const protectionSync = {
    async persistProtectionFromSync(deviceId, health, persistence) {
      calls.push(['persist', deviceId, health, persistence]);
      return { deviceId };
    },
  };
  const protectionPersistence = {
    async listDeviceProtection() {
      return [{
        deviceId: 'd1',
        requestedProfile: 'DEVICE_OWNER',
        achievedProfile: 'HARDENED_ADMIN',
        detectedCapabilities: ['DEVICE_ADMIN'],
      }];
    },
    async getDeviceProtection(deviceId) {
      return {
        deviceId,
        requestedProfile: 'HARDENED_ADMIN',
        achievedProfile: 'HARDENED',
        detectedCapabilities: ['DEFAULT_HOME', 'ACCESSIBILITY'],
      };
    },
  };
  const warnings = [];
  const logger = { warn: (...args) => warnings.push(args) };

  assert.strictEqual(
    installProtectionRuntimeBridge(db, protectionSync, protectionPersistence, logger),
    true,
  );
  assert.strictEqual(
    installProtectionRuntimeBridge(db, protectionSync, protectionPersistence, logger),
    false,
    'bridge must be idempotent',
  );

  const health = { adapterId: 'qin-f21-pro', achievedProtectionProfile: 'HARDENED_ADMIN' };
  const recordResult = await db.recordDeviceHealth('d1', health);
  assert.deepStrictEqual(recordResult, { ok: true });
  assert.strictEqual(calls.filter(c => c[0] === 'persist').length, 1);

  const fleet = await db.listDeviceHealth();
  assert.strictEqual(fleet[0].protection.achievedProfile, 'HARDENED_ADMIN');
  assert.deepStrictEqual(fleet[0].protection.requirements.missingCapabilities, ['DEVICE_OWNER']);
  assert.strictEqual(fleet[0].protection.requirements.requiresReprovisioning, true);
  assert.strictEqual(fleet[1].protection, null);

  const one = await db.getDeviceHealth('d2');
  assert.strictEqual(one.protection.achievedProfile, 'HARDENED');
  assert.deepStrictEqual(one.protection.requirements.missingCapabilities, ['DEVICE_ADMIN']);
  assert.strictEqual(await db.getDeviceHealth('missing'), null);

  assert.deepStrictEqual(warnings, []);

  // Persistence failures are telemetry-only and must never break sync/health.
  const failingDb = {
    async recordDeviceHealth() { return 'saved'; },
    async listDeviceHealth() { return [{ deviceId: 'd3' }]; },
  };
  const failingSync = {
    async persistProtectionFromSync() { throw new Error('db unavailable'); },
  };
  const failingPersistence = {
    async listDeviceProtection() { throw new Error('db unavailable'); },
  };
  const failWarnings = [];
  installProtectionRuntimeBridge(
    failingDb,
    failingSync,
    failingPersistence,
    { warn: (...args) => failWarnings.push(args) },
  );
  assert.strictEqual(await failingDb.recordDeviceHealth('d3', health), 'saved');
  assert.strictEqual((await failingDb.listDeviceHealth())[0].protection, null);
  assert.strictEqual(failWarnings.length, 2);

  console.log('protection runtime bridge tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
