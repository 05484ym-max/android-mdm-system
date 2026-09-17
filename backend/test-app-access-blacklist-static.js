'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const routes = read('backend/appAccessRoutes.js');
const entry = read('backend/universalEntry.js');
const client = read('dpc-app/app/src/main/java/org/mdmopen/dpc/AppAccessPolicyClient.kt');
const sync = read('dpc-app/app/src/main/java/org/mdmopen/dpc/PolicySync.kt');
const reconciler = read('dpc-app/app/src/main/java/org/mdmopen/dpc/AppAccessReconciler.kt');
const receiver = read('dpc-app/app/src/main/java/org/mdmopen/dpc/PackageInstallGuardReceiver.kt');
const panel = read('admin-panel/full-open.js');

assert(routes.includes("app.get('/api/devices/:deviceId/app-access-policy'"), 'device app-access endpoint missing');
assert(routes.includes("app.put('/api/devices/:deviceId/policy/blocked-apps'"), 'admin blocked-apps update endpoint missing');
assert(routes.includes('db.setPolicy(device.deviceId, policy)'), 'blacklist is not persisted in device policy');
assert(routes.includes('push.wake(updated.pushToken)'), 'blacklist mutation does not wake the device');
assert(entry.includes('installAppAccessRoutes(app, { db, push })'), 'app-access routes are not installed');

assert(client.includes('/app-access-policy'), 'DPC app-access endpoint client missing');
assert(client.includes('Authorization'), 'DPC app-access request is not authenticated');
assert(sync.includes('AppAccessPolicyClient(serverUrl, deviceToken).fetch(deviceId)'), 'PolicySync does not fetch blacklist policy');
assert(sync.includes('check(appAccess.mode == expectedMode)'), 'PolicySync does not reject a raced mode snapshot');
assert(sync.includes('AppAccessPolicyStore.setBlockedPackages(context, appAccess.blockedApps)'), 'PolicySync does not persist blacklist');
assert(sync.includes('AppAccessReconciler(context).applyOpenWithBlacklist(appAccess.blockedApps)'), 'open mode does not reconcile blacklist');
assert(sync.indexOf('AppAccessPolicyClient(serverUrl, deviceToken).fetch(deviceId)') < sync.indexOf('ManagedInstallWindow.setDesiredInstallBlocked'), 'install gate opens before blacklist policy is known');

assert(reconciler.includes('clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)'), 'open mode still disallows app installs');
assert(reconciler.includes('val toRelease = tracked - toBlock - protectedPackages'), 'open mode release is not limited to DPC-tracked packages');
assert(reconciler.includes('setPackagesSuspended(admin, toBlock.toTypedArray(), true)'), 'blacklisted apps are not suspended');
assert(reconciler.includes('setApplicationHidden(admin, pkg, true)'), 'blacklisted apps are not hidden');
assert(reconciler.includes('essentialPackages() + context.packageName'), 'protected/core packages are not excluded');

assert(receiver.includes('AppAccessPolicyStore.blockedPackages(context)'), 'package receiver does not consult blacklist');
assert(receiver.includes('setPackagesSuspended(admin, arrayOf(packageName), true)'), 'new/replaced blacklisted package is not suspended');
assert(receiver.includes('setApplicationHidden(admin, packageName, true)'), 'new/replaced blacklisted package is not hidden');

assert(panel.includes('/blocked-apps'), 'admin panel cannot load blacklist');
assert(panel.includes('/policy/blocked-apps'), 'admin panel cannot save blacklist');
assert(panel.includes('רשימה שחורה פרטית'), 'admin panel blacklist UI missing');

console.log('App access blacklist chain regression: OK');
