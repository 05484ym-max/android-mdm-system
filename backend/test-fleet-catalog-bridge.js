'use strict';

const assert = require('assert');
const { CATALOG_SEED_MARKER, installFleetCatalogBridge } = require('./fleetCatalogBridge');

async function main() {
  const devices = new Map([
    ['d1', { deviceId: 'd1', pushToken: 'p1', policy: { allowedApps: ['legacy.app'], kioskEnabled: true } }],
    ['d2', { deviceId: 'd2', pushToken: 'p2', policy: { allowedApps: [], kioskEnabled: false } }],
  ]);
  const catalog = [];
  const wakeCalls = [];

  const clone = value => JSON.parse(JSON.stringify(value));

  const db = {
    async listDevices() {
      return [...devices.values()].map(d => ({ ...d, policy: clone(d.policy) }));
    },
    async getDevice(id) {
      const d = devices.get(id);
      return d ? { ...d, policy: clone(d.policy) } : null;
    },
    async setPolicy(id, policy) {
      const current = devices.get(id);
      const next = { ...current, policy: clone(policy) };
      devices.set(id, next);
      return { ...next, policy: clone(next.policy) };
    },
    async listAppsCatalog() {
      return catalog.map(app => ({ ...app }));
    },
    async addAppToCatalog(packageName, name, iconUrl, playVersion, playUpdatedAt) {
      const index = catalog.findIndex(app => app.packageName === packageName);
      const row = { packageName, name, iconUrl, playVersion, playUpdatedAt, appSource: 'PLAY' };
      if (index >= 0) catalog[index] = { ...catalog[index], ...row };
      else catalog.push(row);
    },
    async insertUploadedApp(payload) {
      const index = catalog.findIndex(app => app.packageName === payload.packageName);
      const row = { ...payload, appSource: 'APK' };
      if (index >= 0) catalog[index] = { ...catalog[index], ...row };
      else catalog.push(row);
      return row;
    },
    async createDevice(deviceId, authTokenHash) {
      const device = { deviceId, authTokenHash, pushToken: null, policy: { allowedApps: [], kioskEnabled: false } };
      devices.set(deviceId, device);
      return { ...device, policy: clone(device.policy) };
    },
  };

  const push = {
    async wake(token) {
      wakeCalls.push(token);
      return token ? { sent: true } : { sent: false, reason: 'no_push_token' };
    },
  };

  installFleetCatalogBridge(db, push, { info() {}, warn() {} });

  await db.addAppToCatalog('com.example.new', 'New', null, '1.0.0', 1000);
  assert.deepStrictEqual(devices.get('d1').policy.allowedApps, ['legacy.app', 'com.example.new']);
  assert.deepStrictEqual(devices.get('d2').policy.allowedApps, ['com.example.new']);
  assert.strictEqual(devices.get('d1').policy.kioskEnabled, true, 'unrelated policy fields must survive');
  assert.strictEqual(devices.get('d1').policy[CATALOG_SEED_MARKER], true, 'first lookup should mark legacy device seeded');
  assert.strictEqual(devices.get('d2').policy[CATALOG_SEED_MARKER], true, 'first lookup should mark empty device seeded');
  assert.deepStrictEqual(wakeCalls.sort(), ['p1', 'p2']);

  wakeCalls.length = 0;
  await db.addAppToCatalog('com.example.new', 'New', null, '1.0.0', 1000);
  assert.deepStrictEqual(wakeCalls, [], 'unchanged Play metadata must not wake the fleet');

  await db.addAppToCatalog('com.example.new', 'New', null, '1.1.0', 2000);
  assert.deepStrictEqual(wakeCalls.sort(), ['p1', 'p2'], 'new Play version should wake devices for update visibility');

  wakeCalls.length = 0;
  const d3 = await db.createDevice('d3', 'hash');
  assert.deepStrictEqual(d3.policy.allowedApps, ['com.example.new'], 'new devices inherit current global catalog');
  assert.strictEqual(d3.policy[CATALOG_SEED_MARKER], true, 'new-device catalog seed must be durable');
  assert.deepStrictEqual(wakeCalls, [], 'registration seeding does not require push');

  await db.insertUploadedApp({ packageName: 'com.example.apk', name: 'APK', apkSha256: 'a'.repeat(64), apkUrl: '/a.apk' });
  assert.ok(devices.get('d1').policy.allowedApps.includes('com.example.apk'));
  assert.ok(devices.get('d2').policy.allowedApps.includes('com.example.apk'));
  assert.ok(devices.get('d3').policy.allowedApps.includes('com.example.apk'));

  // Simulate the exact production failure being repaired: a device row was
  // created while the create-time bridge was not active, so allowedApps is
  // still empty and there is no seed marker. Its next authenticated getDevice
  // (requireDevice -> sync) must repair it in the same request.
  devices.set('d4', {
    deviceId: 'd4',
    pushToken: null,
    policy: { allowedApps: [], kioskEnabled: false },
  });
  const d4 = await db.getDevice('d4');
  assert.deepStrictEqual(
    d4.policy.allowedApps.sort(),
    ['com.example.apk', 'com.example.new'].sort(),
    'missed fresh-enrollment seed must self-heal from the current global catalog',
  );
  assert.strictEqual(d4.policy[CATALOG_SEED_MARKER], true, 'self-healed device must be marked once');

  // Once seeded, an intentional per-device removal - even removing every app -
  // must remain respected forever. setPolicy preserves the hidden marker even
  // when the caller sends only the normalized public policy fields.
  await db.setPolicy('d4', { allowedApps: [], kioskEnabled: false });
  assert.strictEqual(devices.get('d4').policy[CATALOG_SEED_MARKER], true, 'policy writes must preserve seed marker');
  const d4AfterRemoval = await db.getDevice('d4');
  assert.deepStrictEqual(d4AfterRemoval.policy.allowedApps, [], 'intentional empty allowlist must not be repopulated');

  // A pre-marker device with some explicit apps is migrated conservatively:
  // mark it seeded, but never broaden its allowlist behind the admin's back.
  devices.set('d5', {
    deviceId: 'd5',
    pushToken: null,
    policy: { allowedApps: ['custom.only'], kioskEnabled: false },
  });
  const d5 = await db.getDevice('d5');
  assert.deepStrictEqual(d5.policy.allowedApps, ['custom.only'], 'legacy non-empty allowlist must be preserved exactly');
  assert.strictEqual(d5.policy[CATALOG_SEED_MARKER], true, 'legacy non-empty device should still complete migration');

  console.log('fleet catalog bridge tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
