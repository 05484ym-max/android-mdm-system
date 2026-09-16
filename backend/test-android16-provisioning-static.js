const fs = require('fs');
const assert = require('assert');

const mode = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/GetProvisioningModeActivity.kt',
  'utf8'
);
const compliance = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/AdminPolicyComplianceActivity.kt',
  'utf8'
);
const manifest = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/AndroidManifest.xml',
  'utf8'
);
const buildWorkflow = fs.readFileSync(
  __dirname + '/../.github/workflows/build-dpc.yml',
  'utf8'
);
const worker = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/PostProvisionEnrollmentWorker.kt',
  'utf8'
);
const application = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/MdmApplication.kt',
  'utf8'
);
const receiver = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/DpcDeviceAdminReceiver.kt',
  'utf8'
);
const compatibility = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/AndroidCompatibility.kt',
  'utf8'
);

// Android 12+ uses two tiny, separate callbacks like the reference DPC.
assert.match(mode, /ACTION_GET_PROVISIONING_MODE/);
assert.match(mode, /PROVISIONING_MODE_FULLY_MANAGED_DEVICE/);
assert.match(mode, /EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES/);
assert.match(mode, /setResult\(\s*RESULT_OK/);
assert.doesNotMatch(mode, /ApiClient\(/);
assert.doesNotMatch(mode, /PolicySync\.run/);
assert.doesNotMatch(mode, /WorkManager/);
assert.doesNotMatch(mode, /EXTRA_PROVISIONING_SKIP_EDUCATION_SCREENS/);

assert.match(compliance, /ACTION_ADMIN_POLICY_COMPLIANCE/);
assert.match(compliance, /setResult\(RESULT_OK\)/);
assert.doesNotMatch(compliance, /ApiClient\(/);
assert.doesNotMatch(compliance, /PolicySync\.run/);
assert.doesNotMatch(compliance, /WorkManager/);
assert.doesNotMatch(compliance, /PostProvisionEnrollmentScheduler\.enqueue/);

assert.match(manifest, /android:name="\.GetProvisioningModeActivity"/);
assert.match(manifest, /android:name="\.AdminPolicyComplianceActivity"/);
assert.match(manifest, /android\.app\.action\.GET_PROVISIONING_MODE/);
assert.match(manifest, /android\.app\.action\.ADMIN_POLICY_COMPLIANCE/);

// QR provisioning is intentionally minimal while isolating Samsung/Android 16:
// component + signer checksum + versioned APK URL only.
assert.match(buildWorkflow, /PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME/);
assert.match(buildWorkflow, /PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM/);
assert.match(buildWorkflow, /PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION/);
assert.match(buildWorkflow, /mdm\.apk\?v=/);
assert.doesNotMatch(buildWorkflow, /PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM/);
assert.doesNotMatch(buildWorkflow, /PROVISIONING_SKIP_ENCRYPTION/);
assert.doesNotMatch(buildWorkflow, /PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED/);

// Enrollment is durable, network-constrained and retryable after provisioning.
assert.match(worker, /setInitialDelay\(10, TimeUnit\.SECONDS\)/);
assert.match(worker, /NetworkType\.CONNECTED/);
assert.match(worker, /enqueueUniqueWork/);
assert.match(worker, /ExistingWorkPolicy\.KEEP/);
assert.match(worker, /Result\.retry\(\)/);
assert.match(worker, /Config\.setEnrollmentCredentials/);
assert.match(worker, /Config\.clearPendingEnrollmentToken/);
assert.match(worker, /PolicySync\.run\(context\)/);

// Process death immediately after provisioning must re-arm pending enrollment.
assert.match(application, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(this\)/);

// One APK must dynamically support Android 10 through Android 16+.
assert.match(compatibility, /ANDROID_10_11/);
assert.match(compatibility, /ANDROID_12_14/);
assert.match(compatibility, /ANDROID_15/);
assert.match(compatibility, /ANDROID_16_PLUS/);
assert.match(compatibility, /sdk >= 36/);
assert.match(compatibility, /sdk >= 35/);
assert.match(compatibility, /sdk >= 31/);
assert.match(compatibility, /usesLegacyProvisioningCompletion/);

// Android 10/11 and newer devices both retain a durable completion fallback.
assert.match(receiver, /onProfileProvisioningComplete/);
assert.match(receiver, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(context\.applicationContext\)/);
assert.match(receiver, /AndroidCompatibility\.label\(\)/);

console.log('Dynamic Android 10-16 reference provisioning static checks passed');
