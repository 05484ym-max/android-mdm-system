'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const healthPanel = require('./healthPanel');
const diagnostics = require('./diagnostics');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const index = read('backend/index.js');
const protectionRoutes = read('backend/protectionAdminRoutes.js');
const customerSearch = read('admin-panel/customer-search.js');
const healthUi = read('admin-panel/health.js');
const diagnosticsUi = read('admin-panel/diagnostics.js');
const supportUi = read('admin-panel/support.js');
const newsUi = read('admin-panel/news.js');
const fullOpenUi = read('admin-panel/full-open.js');
const subscriptionUi = read('admin-panel/subscription-unblock.js');
const releaseUi = read('admin-panel/permanent-release.js');
const appImportUi = read('admin-panel/app-import.js');
const apkUploadUi = read('admin-panel/apk-upload.js');

function includes(source, text, label) {
  assert(source.includes(text), `missing ${label}: ${text}`);
}
function excludes(source, text, label) {
  assert(!source.includes(text), `obsolete ${label} still present: ${text}`);
}

// Backend contract for every standalone admin-panel module.
[
  ['/api/devices/:deviceId/subscription-unblock', index],
  ['/api/devices/:deviceId/full-open', index],
  ['/api/devices/:deviceId/dns/allow-customer-toggle', index],
  ['/api/devices/:deviceId/policy/whatsapp-guard', index],
  ['/api/health/summary', index],
  ['/api/health/devices', index],
  ['/api/health/devices/:deviceId/diagnostics', index],
  ['/api/health/devices/:deviceId/actions/retry-sync', index],
  ['/api/health/devices/:deviceId/actions/retry-update', index],
  ['/api/alerts', index],
  ['/api/support-tickets', index],
  ['/api/customer-updates', index],
  ['/api/apps/play-search', index],
  ['/api/apps/from-play', index],
  ['/api/apps/upload-apk', index],
  ['/api/apps/categories', index],
  ['/api/health/devices/:deviceId/protection/requested', protectionRoutes],
].forEach(([route, source]) => includes(source, route, 'backend route'));

// Dangerous release paths must re-authenticate on both sides.
includes(releaseUi, "adminPassword", 'release password prompt');
includes(index, "command === 'WIPE' || command === 'RELEASE_DEVICE_OWNER'", 'irreversible command re-auth gate');
includes(index, 'bcrypt.compareSync(adminPassword, ADMIN_PASSWORD_HASH)', 'server password verification');

// Admin status must match the DPC fail-open behavior.
excludes(customerSearch, 'WhatsApp יישאר נעול עד אז', 'stale WhatsApp fail-closed status');
includes(customerSearch, 'WhatsApp נשאר זמין, אך הסינון אינו נאכף כרגע', 'WhatsApp fail-open status');

// Remove placeholders and dry-run noise that are not actionable diagnostics.
excludes(healthUi, 'על גרסה ישנה', 'unimplemented version diagnostic');
excludes(healthUi, 'בקרוב', 'placeholder health value');
excludes(diagnosticsUi, 'DRY-RUN', 'non-actionable launcher dry-run');
excludes(diagnosticsUi, 'wouldHideNoLauncherPackages', 'non-actionable launcher dry-run data');

// Repair buttons must describe currently available actions, not future work.
const diagnosticsSource = read('backend/diagnostics.js');
excludes(diagnosticsSource, 'ניתן יהיה בעתיד', 'stale future repair guidance');
excludes(diagnosticsSource, 'כרגע אין פעולה אוטומטית זמינה', 'stale update repair guidance');
includes(diagnosticsSource, 'נסה עדכון מחדש באמצעות הכפתור כאן', 'update repair guidance');
includes(diagnosticsSource, 'נסה סנכרון מחדש באמצעות הכפתור כאן', 'sync repair guidance');

// Network/auth handling on every separately loaded mutating admin feature.
[
  ['support', supportUi],
  ['news', newsUi],
  ['full-open', fullOpenUi],
  ['subscription exception', subscriptionUi],
  ['permanent release', releaseUi],
  ['Play import', appImportUi],
  ['APK upload', apkUploadUi],
].forEach(([name, source]) => {
  includes(source, '401', `${name} session-expiry handling`);
});
includes(supportUi, 'catch', 'support network failure handling');
includes(newsUi, 'catch', 'news network failure handling');
includes(subscriptionUi, 'Number.isInteger', 'subscription day validation');
includes(apkUploadUi, '150 * 1024 * 1024', 'APK client size limit');

// The health dashboard and the per-device diagnosis must agree on concrete
// scenarios. This catches drift between summary status and actionable faults.
const now = Date.parse('2026-09-14T12:00:00Z');
const base = {
  deviceId: '1000000001',
  registeredAt: '2026-09-10T12:00:00Z',
  syncIntervalMinutes: 60,
  lastSeenAt: '2026-09-14T11:45:00Z',
  lastSyncAt: '2026-09-14T11:40:00Z',
  currentVersionCode: 100,
  isDeviceOwner: true,
  batteryLevel: 80,
  freeStorageBytes: 4 * 1024 * 1024 * 1024,
  lastUpdateStatus: 'SUCCESS',
};

function expectScenario(patch, expectedStatus, expectedCodes) {
  const device = { ...base, ...patch };
  const classified = healthPanel.classify(device, now);
  const faults = diagnostics.diagnose(device, now);
  assert.strictEqual(classified.status, expectedStatus, `unexpected status for ${JSON.stringify(patch)}`);
  assert.deepStrictEqual(faults.map(f => f.code).sort(), [...expectedCodes].sort(), `unexpected faults for ${JSON.stringify(patch)}`);
}

expectScenario({}, 'ok', []);
expectScenario({ isDeviceOwner: false }, 'critical', ['DEVICE_OWNER_LOST']);
expectScenario({ lastUpdateStatus: 'FAILED', lastUpdateVersion: 101, lastUpdateError: 'install failed' }, 'critical', ['UPDATE_FAILED']);
expectScenario({ lastSyncAt: '2026-09-14T04:00:00Z' }, 'warning', ['SYNC_STALE']);
expectScenario({ batteryLevel: 10 }, 'warning', ['LOW_BATTERY']);
expectScenario({ freeStorageBytes: 100 * 1024 * 1024 }, 'warning', ['LOW_STORAGE']);
expectScenario({ lastSeenAt: '2026-09-12T12:00:00Z', lastSyncAt: '2026-09-12T12:00:00Z' }, 'critical', ['DEVICE_OFFLINE']);

// Feature endpoint references in the UI are intentional and present.
includes(fullOpenUi, '/full-open', 'full-open UI call');
includes(subscriptionUi, '/subscription-unblock', 'subscription UI call');
includes(diagnosticsUi, '/actions/', 'diagnostic repair call');
includes(diagnosticsUi, '/dns/allow-customer-toggle', 'DNS customer-toggle call');
includes(appImportUi, '/api/apps/play-search', 'Play search UI call');
includes(apkUploadUi, '/api/apps/upload-apk', 'APK upload UI call');

console.log('Admin panel functional audit: OK');
