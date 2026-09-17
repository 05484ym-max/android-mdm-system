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
const policyEnforcer = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PolicyEnforcer.kt', 'utf8');
const commandExecutor = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/CommandExecutor.kt', 'utf8');
const installResult = fs.readFileSync(__dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/InstallResultReceiver.kt', 'utf8');
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

// Managed APK path is metadata-driven and one-tap; Play is only the fallback.
assert.doesNotMatch(customer, /if \(app\.appSource != "APK"\)/);
assert.match(customer, /val apkUrl = app\.apkUrl\?\.trim\(\)\?\.takeIf/);
assert.match(customer, /val apkSha256 = app\.apkSha256\?\.trim\(\)\?\.takeIf/);
assert.match(customer, /if \(apkUrl == null \|\| apkSha256 == null\)[\s\S]*openPlayStoreForInstall\(app\.packageName\)/);
assert.match(customer, /AppInstaller\(applicationContext\)\.installFromUrl\(apkUrl, apkSha256\)/);

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
assert.match(playGate, /launchBlockingActivity\(appContext\)/);
assert.match(playGate, /ManagedInstallWindow\.open\(appContext\)[\s\S]*refreshKioskPolicy\(appContext, failOnError = true\)/);
assert.match(playGate, /Config\.setPlayStoreAllowedUntil\(appContext, System\.currentTimeMillis\(\)\)[\s\S]*refreshKioskPolicy\(appContext\)/);
assert.match(playGate, /Config\.setPlayStoreAllowedUntil\(context, System\.currentTimeMillis\(\)\)[\s\S]*refreshKioskPolicy\(context\)/);
assert.match(playGate, /private fun closePlayUi[\s\S]*InstallOverlay\.hide\(context\)/);

assert.match(installOverlay, /SHIELD_HEIGHT_RATIO = 0\.69f/);
assert.match(installOverlay, /heightPixels \* SHIELD_HEIGHT_RATIO/);
assert.match(installOverlay, /gravity = Gravity\.BOTTOM/);
assert.match(installOverlay, /isIndeterminate = true/);
assert.doesNotMatch(installOverlay, /התקנה מאובטחת פעילה/);
assert.doesNotMatch(installOverlay, /החלק העליון של Google Play נשאר גלוי כדי שתראה/);
assert.match(installOverlay, /text = "מתקין את \$appName"/);
assert.match(installOverlay, /Settings\.canDrawOverlays\(appContext\)/);
assert.match(installOverlay, /PlayStoreGate\.cancelCurrentInstall\(appContext\)/);
assert.match(installOverlay, /סגור וחזור לחנות/);

assert.match(policyEnforcer, /fun restoreCachedKioskPolicy\(\)[\s\S]*enableKiosk\(Config\.allowedApps\(context\)\.toSet\(\) \+ playStoreTemporaryAllowance\(\)\)/);
assert.match(commandExecutor, /"REBOOT" -> \{[\s\S]*PlayInstallGuard\.activeSession\(context\) == null && !ManagedInstallWindow\.isOpen\(context\)[\s\S]*dpm\.reboot\(admin\)/);
assert.match(installResult, /if \(commandId == null\)[\s\S]*PackageInstaller\.STATUS_SUCCESS[\s\S]*PlayCatalogUpdateState\.acknowledgeInstalledVersion[\s\S]*CustomerActivity::class\.java/);

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
assert.match(playCatalogState, /playUpdatedAt = item\.optLong\("playUpdatedAt", 0L\)/);
assert.match(playCatalogState, /installed\.lastUpdateTime >= playUpdatedAt/);
assert.match(playCatalogState, /item\.put\("playVersion", installed\.versionName\)/);
assert.match(playCatalogState, /info\.lastUpdateTime/);
assert.match(playCatalogState, /currentRemote == acknowledgedRemote && currentInstalled == acknowledgedInstalled/);
assert.match(playCatalogState, /item\.put\("playVersion", acknowledgedInstalled\)/);
assert.match(policySync, /Config\.setAppCatalog\(context, result\.catalog\)[\s\S]*PlayCatalogUpdateState\.reapplyAcknowledgements\(context\)/);

assert.match(manifest, /android:name="\.PackageInstallGuardReceiver"/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_ADDED/);
assert.match(manifest, /android\.intent\.action\.PACKAGE_REPLACED/);
assert.match(manifest, /android:name="\.PlayInstallBlockingActivity"/);

console.log('Play update watcher and guarded Play install static checks passed');
