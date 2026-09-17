'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { diagnose } = require('./diagnostics');

const NOW = Date.UTC(2026, 8, 17, 6, 0, 0);
const base = {
  deviceId: 'device-test',
  registeredAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
  lastSeenAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
  lastSyncAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
  currentVersionCode: 228,
  isDeviceOwner: true,
  lastUpdateStatus: 'SUCCESS',
  freeStorageBytes: 2 * 1024 * 1024 * 1024,
  currentNetworkType: 'WIFI',
  dnsFilteringRequested: true,
  dnsFilteringActual: true,
  dnsResolutionOk: true,
  dotProviderReachable: true,
  dnsFailSafeState: 'NORMAL',
};

function codes(device) {
  return diagnose({ ...base, ...device }, NOW).map(f => f.code);
}

assert(codes({ isDeviceOwner: false }).includes('DEVICE_OWNER_LOST'));
assert(codes({ lastUpdateStatus: 'FAILED', lastUpdateVersion: 229, lastUpdateError: 'install failed' }).includes('UPDATE_FAILED'));
assert(codes({ freeStorageBytes: 150 * 1024 * 1024 }).includes('LOW_STORAGE'));
assert(codes({ dnsFilteringRequested: true, dnsFilteringActual: false }).includes('DNS_FILTER_MISMATCH'));
assert(codes({ dnsResolutionOk: false }).includes('DNS_RESOLUTION_FAILED'));
assert(codes({ dotProviderReachable: false }).includes('DNS_PROVIDER_UNREACHABLE'));
assert(codes({ dnsFailSafeState: 'ROLLED_BACK' }).includes('DNS_FAILSAFE_ACTIVE'));
assert(!codes({ currentNetworkType: 'NONE', dnsResolutionOk: false }).includes('DNS_RESOLUTION_FAILED'));

const ui = fs.readFileSync(path.join(__dirname, '..', 'admin-panel', 'alerts.js'), 'utf8');
for (const marker of ['מה קרה?', 'מה זה גורם?', 'מה עושים?', 'מי מטפל?']) {
  assert(ui.includes(marker), `missing simple UI marker: ${marker}`);
}
for (const code of ['DEVICE_OWNER_LOST', 'UPDATE_FAILED', 'LOW_STORAGE', 'DNS_FILTER_MISMATCH', 'DNS_RESOLUTION_FAILED', 'DNS_PROVIDER_UNREACHABLE', 'DNS_FAILSAFE_ACTIVE']) {
  assert(ui.includes(code), `missing UI explanation for ${code}`);
}

console.log('simple fault center tests passed');
