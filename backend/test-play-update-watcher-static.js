const fs = require('fs');
const assert = require('assert');
const index = fs.readFileSync(__dirname + '/index.js', 'utf8');
const db = fs.readFileSync(__dirname + '/db.js', 'utf8');
const customer = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/CustomerActivity.kt', 'utf8');
const playGate = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayStoreGate.kt', 'utf8');
const playGuard = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayInstallGuard.kt', 'utf8');
const packageGuard = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PackageInstallGuardReceiver.kt', 'utf8');
const playUi = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayInstallBlockingActivity.kt', 'utf8');
const installOverlay = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/InstallOverlay.kt', 'utf8');
const playCatalogState = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PlayCatalogUpdateState.kt', 'utf8');
const policySync = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PolicySync.kt', 'utf8');
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

assert.match(playGate, /PlayInstallGuard\.begin\(appContext, packageName, deadline\)/);
assert.match(playGate, /PlayInstallStatusStore\.begin\(appContext, session\.id, packageName, appName\)/);
assert.match(playGate, /InstallOverlay\.show\(appContext, appName\)/);
assert.match(playGate, /PlayInstallStage\.WAITING/);
assert.doesNotMatch(playGate, /REVEAL_WINDOW_MS/);
assert.match(playGate, /postDelayed\([\s\S]*500L/);
assert.match(playGate, /completeBecauseTargetInstalled/);
assert.match(playGate, /abortBecauseUnauthorizedInstall/);
assert.match(playGate, /ManagedInstallWindow\.close\(appContext\)/);
assert.match(playGate, /recoverAfterProcessStart/);
assert.match(playGate, /PlayCatalogUpdateState\.acknowledgeInstalledVersion\(context, packageName\)/);
assert.match(playGate, /completeAlreadyCurrent\(context, packageName, sessionId\)/);
assert.match(playGate, /fun cancelCurrentInstall\(/);
assert.match(playGate, /if \(startingVersion != null && currentVersion != null\)/);
assert.match(playGate, /Intent\.FLAG_ACTIVITY_CLEAR_TASK/);
assert.doesNotMatch(playGate, /launchBlockingActivity/);

assert.match(installOverlay, /heightPixels \* 0\.55f/);
assert.match(installOverlay, /gravity = Gravity\.BOTTOM/);
assert.match(installOverlay, /isIndeterminate = true/);
assert.match(installOverlay, /החלק העליון של Google Play נשאר גלוי/);
assert.match(installOverlay, /PlayStoreGate\.cancelCurrentInstall\(appContext\)/);
assert.match(installOverlay, /סגור וחזור לחנות/);

assert.match(playGuard, /KEY_TARGET_PACKAGE/);
assert.match(playGuard, /ManagedInstallWindow\.close\(context\)/);
assert.match(packageGuard, /Intent\.ACTION_PACKAGE_ADDED/);
assert.match(packageGuard, /Intent\.ACTION_PACKAGE_REPLACED/);
assert.match(packageGuard, /changedPackage == session\.targetPackage/);
assert.match(packageGuard, /PlayStoreGate\.completeBecauseTargetInstalled\(context, changedPackage\)/);
assert.match(packageGuard, /if \(replacing\)[\s\S]*return/);
assert.match(packageGuard, /setPackagesSuspended\(admin, arrayOf\(changedPackage\), true\)/);
assert.match(packageGuard, /setApplicationHidden\(admin, changedPackage, true\)/);
assert.match(packageGuard, /AppInstaller\(appContext\)\.uninstall\(changedPackage\)/);
assert.match(packageGuard, /Keep the approved Play[\s\S]*session open/);

assert.match(playUi, /isIndeterminate = true/);
assert.doesNotMatch(playUi, /progress\s*=\s*\d+/);
assert.match(playUi, /PlayStoreGate\.cancelCurrentInstall\(applicationContext/);
assert.match(playUi, /סגור וחזור לחנות/);
assert.match(playUi, /if \(completed\) returnToStore\(\)/);
assert.doesNotMatch(playUi, /completed && hasWindowFocus\(\)/);

assert.match(playCatalogState, /fun acknowledgeInstalledVersion\(/);
assert.match(playCatalogState, /ACK_PREFS = "dpc_play_catalog_ack"/);
assert.match(playCatalogState, /putString\(remoteKey\(packageName\), advertisedVersion\)/);
assert.match(playCatalogState, /fun reapplyAcknowledgements\(/);
assert.match(playCatalogState, /currentRemote == acknowledgedRemote && currentInstalled == acknowledgedInstalled/);
assert.match(playCatalogState, /item\.put\("playVersion", acknowledgedInstalled\)/);
assert.match(policySync, /Config\.setAppCatalog\(context, result\.catalog\)[\s\S]*PlayCatalogUpdateState\.reapplyAcknowledgements\(context\)/);

assert.match(manifest, /android:name="\.PackageInstallGuardReceiver"/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_ADDED/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_REPLACED/);
assert.match(manifest, /android:name="\.PlayInstallBlockingActivity"/);

console.log('Play update watcher and guarded Play install static checks passed');
