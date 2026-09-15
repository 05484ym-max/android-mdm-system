'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const healthPanel = require('./healthPanel');
const diagnostics = require('./diagnostics');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const index = read('backend/index.js');
const panelHtml = read('admin-panel/index.html');
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

includes(releaseUi, 'adminPassword', 'release password prompt');
includes(index, "command === 'WIPE' || command === 'RELEASE_DEVICE_OWNER'", 'irreversible command re-auth gate');
includes(index, 'bcrypt.compareSync(adminPassword, ADMIN_PASSWORD_HASH)', 'server password verification');

excludes(customerSearch, 'WhatsApp יישאר נעול עד אז', 'stale WhatsApp fail-closed status');
includes(customerSearch, 'מצב חסימת WhatsApp במכשיר:', 'actual WhatsApp block status');
includes(customerSearch, 'מצב נגישות:', 'separate accessibility status');
includes(customerSearch, 'data-wa-channels-only', 'channels-only WhatsApp preset');
includes(customerSearch, 'data-inline-diagnostics-content', 'inline customer diagnostics');
includes(customerSearch, 'setCustomerFocus(true)', 'focused customer workspace');
includes(diagnosticsUi, 'loadDeviceDiagnosticsInline', 'reusable inline diagnostics loader');
includes(panelHtml, 'data-tab-content="customers"', 'customers workspace');
includes(panelHtml, 'חיפוש לקוח — שם, מספר לקוח או מזהה מכשיר', 'customer-only search label');
excludes(panelHtml, 'data-tab="health"', 'separate health navigation');

const customersTabAt = panelHtml.indexOf('data-tab-content="customers"');
const quickSearchAt = panelHtml.indexOf('id="quickCustomerSearch"');
assert(customersTabAt >= 0 && quickSearchAt > customersTabAt, 'customer search must live inside the customers tab');

excludes(healthUi, 'על גרסה ישנה', 'unimplemented version diagnostic');
excludes(healthUi, 'בקרוב', 'placeholder health value');
excludes(diagnosticsUi, 'DRY-RUN', 'non-actionable launcher dry-run');
excludes(diagnosticsUi, 'wouldHideNoLauncherPackages', 'non-actionable launcher dry-run data');

const diagnosticsSource = read('backend/diagnostics.js');
excludes(diagnosticsSource, 'ניתן יהיה בעתיד', 'stale future repair guidance');
excludes(diagnosticsSource, 'סיבה סבירה', 'overly verbose diagnosis wording');
includes(diagnosticsSource, 'solution:', 'every server fault has a practical solution');
includes(diagnosticsSource, 'נסה עדכון מחדש', 'update repair guidance');
includes(diagnosticsSource, 'נסה סנכרון מחדש', 'sync repair guidance');
includes(diagnosticsUi, 'פתרון:', 'simple solution label in panel');
includes(diagnosticsUi, 'WHATSAPP_ACCESSIBILITY_OFF', 'WhatsApp accessibility diagnostic');
includes(diagnosticsUi, 'PUSH_TOKEN_MISSING', 'push-token diagnostic');
includes(diagnosticsUi, 'COMMAND_STUCK', 'stuck-command diagnostic');
includes(diagnosticsUi, '/api/enrollments', 're-enrollment repair action');

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
  faults.forEach(f => assert(f.solution && f.solution.trim(), `fault ${f.code} has no solution`));
}

expectScenario({}, 'ok', []);
expectScenario({ isDeviceOwner: false }, 'critical', ['DEVICE_OWNER_LOST']);
expectScenario({ lastUpdateStatus: 'FAILED', lastUpdateVersion: 101, lastUpdateError: 'install failed' }, 'critical', ['UPDATE_FAILED']);
expectScenario({ lastSyncAt: '2026-09-14T04:00:00Z' }, 'warning', ['SYNC_STALE']);
// Battery/storage remain useful facts in the device card, but are not management faults by themselves.
expectScenario({ batteryLevel: 10 }, 'ok', []);
expectScenario({ freeStorageBytes: 100 * 1024 * 1024 }, 'ok', []);
expectScenario({ lastSeenAt: '2026-09-12T12:00:00Z', lastSyncAt: '2026-09-12T12:00:00Z' }, 'critical', ['DEVICE_OFFLINE']);

includes(fullOpenUi, '/full-open', 'full-open UI call');
includes(subscriptionUi, '/subscription-unblock', 'subscription UI call');
includes(diagnosticsUi, '/actions/', 'diagnostic repair call');
includes(diagnosticsUi, 'ENABLE_DNS_FILTERING', 'DNS enable repair action');
includes(diagnosticsUi, 'DISABLE_DNS_FILTERING', 'DNS disable repair action');
includes(appImportUi, '/api/apps/play-search', 'Play search UI call');
includes(apkUploadUi, '/api/apps/upload-apk', 'APK upload UI call');

console.log('Admin panel functional audit: OK');
