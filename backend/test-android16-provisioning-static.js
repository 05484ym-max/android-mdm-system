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

// Android provisioning compliance must return promptly. Network enrollment and
// policy sync are forbidden from the setup-wizard callback itself.
assert.match(provisioning, /ACTION_ADMIN_POLICY_COMPLIANCE -> runComplianceStep\(\)/);
assert.match(provisioning, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(applicationContext\)/);
assert.match(provisioning, /setResult\(RESULT_OK\)/);
assert.doesNotMatch(provisioning, /ApiClient\(/);
assert.doesNotMatch(provisioning, /PolicySync\.run/);
assert.doesNotMatch(provisioning, /Thread\s*\{/);
assert.doesNotMatch(provisioning, /COMPLIANCE_TIMEOUT_MS/);

// Enrollment is durable, network-constrained and retryable after provisioning.
assert.match(worker, /NetworkType\.CONNECTED/);
assert.match(worker, /enqueueUniqueWork/);
assert.match(worker, /ExistingWorkPolicy\.REPLACE/);
assert.match(worker, /Result\.retry\(\)/);
assert.match(worker, /Config\.setEnrollmentCredentials/);
assert.match(worker, /Config\.clearPendingEnrollmentToken/);
assert.match(worker, /PolicySync\.run\(context\)/);

// Process death immediately after provisioning must re-arm pending enrollment.
assert.match(application, /PostProvisionEnrollmentScheduler\.enqueueIfPending\(this\)/);

console.log('Android 16 provisioning compliance static checks passed');
