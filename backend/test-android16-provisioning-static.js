const fs = require('fs');
const assert = require('assert');

const provisioning = fs.readFileSync(
  __dirname + '/../dpc-app/app/src/main/java/org/mdmopen/dpc/ProvisioningActivity.kt',
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

// Android provisioning compliance must return promptly. Network enrollment and
// policy sync are forbidden from the setup-wizard callback itself.
assert.match(provisioning, /ACTION_ADMIN_POLICY_COMPLIANCE -> runComplianceStep\(\)/);
assert.match(provisioning, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(applicationContext\)/);
assert.match(provisioning, /setResult\(RESULT_OK\)/);
assert.doesNotMatch(provisioning, /ApiClient\(/);
assert.doesNotMatch(provisioning, /PolicySync\.run/);
assert.doesNotMatch(provisioning, /Thread\s*\{/);
assert.doesNotMatch(provisioning, /COMPLIANCE_TIMEOUT_MS/);

// Never accept a managed-profile fallback when the product requires Device Owner.
assert.match(provisioning, /PROVISIONING_MODE_FULLY_MANAGED_DEVICE/);
assert.match(provisioning, /!allowed\.contains\(fullyManaged\)/);
assert.match(provisioning, /setResult\(RESULT_CANCELED\)/);

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

// Android 10/11 and newer devices both get a durable provisioning-complete path.
assert.match(receiver, /onProfileProvisioningComplete/);
assert.match(receiver, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(context\.applicationContext\)/);
assert.match(receiver, /AndroidCompatibility\.label\(\)/);

console.log('Dynamic Android 10-16 provisioning static checks passed');
