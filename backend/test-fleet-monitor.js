const assert = require('assert');
const { analyzeFleet, classifyScope, SAFE_AUTO_HEAL_CODES } = require('./fleetMonitor');

function healthy(id, overrides = {}) {
  const now = Date.now();
  return {
    deviceId: id,
    currentVersionCode: 228,
    androidVersion: '14',
    manufacturer: 'Samsung',
    model: 'A31',
    lastSeenAt: new Date(now - 60 * 1000).toISOString(),
    lastSyncAt: new Date(now - 60 * 1000).toISOString(),
    isDeviceOwner: true,
    lastUpdateStatus: 'SUCCESS',
    freeStorageBytes: 2 * 1024 * 1024 * 1024,
    dnsFilteringRequested: false,
    dnsFilteringActual: false,
    dnsResolutionOk: true,
    dotProviderReachable: true,
    dnsFailSafeState: 'NORMAL',
    currentNetworkType: 'WIFI',
    ...overrides,
  };
}

// One affected device in a real fleet must remain a device-local issue.
{
  const fleet = Array.from({ length: 50 }, (_, i) => healthy(`d${i}`));
  fleet[0].lastUpdateStatus = 'FAILED';
  fleet[0].lastUpdateVersion = 229;
  const result = analyzeFleet(fleet);
  const incident = result.incidents.find(i => i.faultCode === 'UPDATE_FAILED');
  assert(incident, 'UPDATE_FAILED incident should exist');
  assert.strictEqual(incident.scope, 'DEVICE');
  assert.strictEqual(incident.affectedCount, 1);
  assert.strictEqual(incident.autoHealAllowed, false, 'failed updates must not auto-heal blindly');
}

// A release-specific failure should be recognized as a cluster before it is
// mislabeled as a fleet-wide outage.
{
  const fleet = [];
  for (let i = 0; i < 100; i++) {
    const brokenRelease = i < 8;
    fleet.push(healthy(`v${i}`, {
      currentVersionCode: brokenRelease ? 229 : 228,
      lastUpdateStatus: brokenRelease ? 'FAILED' : 'SUCCESS',
      lastUpdateVersion: brokenRelease ? 230 : null,
    }));
  }
  const result = analyzeFleet(fleet);
  const incident = result.incidents.find(i => i.faultCode === 'UPDATE_FAILED');
  assert(incident, 'release cluster should be detected');
  assert.strictEqual(incident.scope, 'CLUSTER');
  assert(incident.reason.includes('גרסת אפליקציה 229'));
}

// A sufficiently broad failure becomes fleet-wide and must suppress automatic
// recovery actions even if the fault type is normally safe to retry.
{
  const fleet = Array.from({ length: 100 }, (_, i) => healthy(`s${i}`, {
    lastSeenAt: new Date().toISOString(),
    lastSyncAt: i < 30 ? new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString() : new Date().toISOString(),
  }));
  const result = analyzeFleet(fleet);
  const incident = result.incidents.find(i => i.faultCode === 'SYNC_STALE');
  assert(incident, 'SYNC_STALE incident should exist');
  assert.strictEqual(incident.scope, 'FLEET');
  assert.strictEqual(incident.autoHealAllowed, false);
}

// Safe retry list is intentionally tiny: wake/sync only, never destructive or
// management-changing actions.
assert(SAFE_AUTO_HEAL_CODES.has('SYNC_STALE'));
assert(SAFE_AUTO_HEAL_CODES.has('DNS_FILTER_MISMATCH'));
assert(!SAFE_AUTO_HEAL_CODES.has('UPDATE_FAILED'));
assert(!SAFE_AUTO_HEAL_CODES.has('DEVICE_OWNER_LOST'));
assert(!SAFE_AUTO_HEAL_CODES.has('DNS_RESOLUTION_FAILED'));

// Direct scope classifier should not call a tiny two-device lab a fleet outage.
{
  const all = [healthy('a'), healthy('b')];
  const scope = classifyScope('X', all, all);
  assert.notStrictEqual(scope.scope, 'FLEET');
}

console.log('fleet monitor tests passed');
