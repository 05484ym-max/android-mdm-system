'use strict';

const assert = require('assert');
const { installFleetCatalogBridge } = require('./fleetCatalogBridge');

async function main() {
  const devices = new Map([
    ['d1', { deviceId: 'd1', pushToken: 'p1', policy: { allowedApps: ['legacy.app'], kioskEnabled: true } }],
    ['d2', { deviceId: 'd2', pushToken: 'p2', policy: { allowedApps: [], kioskEnabled: false } }],
  ]);
  const catalog = [];
  const wakeCalls = [];

  const db = {
    async listDevices() {
      return [...devices.values()].map(d => ({ ...d, policy: JSON.parse(JSON.stringify(d.policy)) }));
    },
    async getDevice(id) {
      const d = devices.get(id);
      return d ? { ...d, policy: JSON.parse(JSON.stringify(d.policy)) } : null;
    },
    async setPolicy(id, policy) {
      const current = devices.get(id);
      const next = { ...current, policy: JSON.parse(JSON.stringify(policy)) };
      devices.set(id, next);
      return { ...next, policy: JSON.parse(JSON.stringify(next.policy)) };
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
      return { ...device, policy: JSON.parse(JSON.stringify(device.policy)) };
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
  assert.deepStrictEqual(wakeCalls.sort(), ['p1', 'p2']);

  wakeCalls.length = 0;
  await db.addAppToCatalog('com.example.new', 'New', null, '1.0.0', 1000);
  assert.deepStrictEqual(wakeCalls, [], 'unchanged Play metadata must not wake the fleet');

  await db.addAppToCatalog('com.example.new', 'New', null, '1.1.0', 2000);
  assert.deepStrictEqual(wakeCalls.sort(), ['p1', 'p2'], 'new Play version should wake devices for update visibility');

  wakeCalls.length = 0;
  const d3 = await db.createDevice('d3', 'hash');
  assert.deepStrictEqual(d3.policy.allowedApps.sort(), ['com.example.new'], 'new devices inherit current global catalog');
  assert.deepStrictEqual(wakeCalls, [], 'registration seeding does not require push');

  await db.insertUploadedApp({ packageName: 'com.example.apk', name: 'APK', apkSha256: 'a'.repeat(64), apkUrl: '/a.apk' });
  assert.ok(devices.get('d1').policy.allowedApps.includes('com.example.apk'));
  assert.ok(devices.get('d2').policy.allowedApps.includes('com.example.apk'));
  assert.ok(devices.get('d3').policy.allowedApps.includes('com.example.apk'));

  console.log('fleet catalog bridge tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
