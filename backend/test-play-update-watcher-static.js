const fs = require('fs');
const assert = require('assert');
const index = fs.readFileSync(__dirname + '/index.js', 'utf8');
const db = fs.readFileSync(__dirname + '/db.js', 'utf8');
const customer = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt', 'utf8');
const playGate = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayStoreGate.kt', 'utf8');
const playGuard = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayInstallGuard.kt', 'utf8');
const packageGuard = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PackageInstallGuardReceiver.kt', 'utf8');
const playUi = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayInstallBlockingActivity.kt', 'utf8');
const manifest = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/AndroidManifest.xml', 'utf8');

assert.match(index, /PLAY_METADATA_FRESH_MS = 10 \* 60 \* 1000/);
assert.match(index, /AUTO_PLAY_REFRESH_INTERVAL_MS = 2 \* 60 \* 1000/);
assert.match(index, /function playVersionChanged\(/);
assert.match(index, /reason: 'app_update'/);
assert.match(index, /wakeDevicesForPlayUpdate\(appInfo\.packageName\)/);
assert.match(db, /async function listPushTokensForApp\(packageName\)/);
assert.match(db, /full_open_mode = true/);
assert.match(db, /policy->'allowedApps'/);
assert.match(customer, /private fun isUpdateAvailable\(app: CatalogApp, installed: Boolean\): Boolean/);
assert.match(customer, /installedVersion != remoteVersion/);
assert.match(customer, /updateAvailable -> "עדכון זמין"/);

// A Play install/update window must be package-scoped. The target package is
// persisted before the global install restriction is lifted; PACKAGE_ADDED and
// PACKAGE_REPLACED must complete only the exact target and quarantine any other
// package. The blocking UI is indeterminate: no fabricated percentage contract.
assert.match(playGate, /PlayInstallGuard\.begin\(appContext, packageName, deadline\)/);
assert.match(playGate, /PlayInstallStatusStore\.begin\(appContext, session\.id, packageName, appName\)/);
assert.match(playGate, /completeBecauseTargetInstalled/);
assert.match(playGate, /abortBecauseUnauthorizedInstall/);
assert.match(playGate, /ManagedInstallWindow\.close\(appContext\)/);
assert.match(playGate, /recoverAfterProcessStart/);
assert.match(playGuard, /KEY_TARGET_PACKAGE/);
assert.match(playGuard, /ManagedInstallWindow\.close\(context\)/);
assert.match(packageGuard, /Intent\.ACTION_PACKAGE_ADDED/);
assert.match(packageGuard, /Intent\.ACTION_PACKAGE_REPLACED/);
assert.match(packageGuard, /changedPackage == session\.targetPackage/);
assert.match(packageGuard, /PlayStoreGate\.completeBecauseTargetInstalled\(context, changedPackage\)/);
assert.doesNotMatch(packageGuard, /getBooleanExtra\(Intent\.EXTRA_REPLACING, false\)\) return/);
assert.match(packageGuard, /setPackagesSuspended\(admin, arrayOf\(changedPackage\), true\)/);
assert.match(packageGuard, /setApplicationHidden\(admin, changedPackage, true\)/);
assert.match(packageGuard, /PlayStoreGate\.abortBecauseUnauthorizedInstall\(appContext, changedPackage\)/);
assert.match(playUi, /isIndeterminate = true/);
assert.doesNotMatch(playUi, /progress\s*=\s*\d+/);
assert.match(manifest, /android:name="\.PackageInstallGuardReceiver"/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_ADDED/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_REPLACED/);
assert.match(manifest, /android:name="\.PlayInstallBlockingActivity"/);

console.log('Play update watcher and guarded Play install static checks passed');
