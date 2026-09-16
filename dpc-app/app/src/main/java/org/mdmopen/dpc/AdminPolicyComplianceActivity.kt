package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.os.Bundle
import android.os.PersistableBundle
import android.util.Log

/**
 * Android 12+ policy-compliance callback.
 *
 * Setup Wizard is waiting synchronously for this result. Persist only the small
 * admin-extras bundle and return RESULT_OK immediately. Any enrollment/policy
 * work is re-armed after provisioning and must never block this activity.
 */
class AdminPolicyComplianceActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (intent.action != DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE) {
            Log.e(TAG, "Unexpected action: ${intent.action}")
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        runCatching { persistAdminExtras() }
            .onFailure { Log.e(TAG, "Could not persist provisioning admin extras", it) }

        // Match the reference DPC contract: compliance completion itself is
        // synchronous; background enrollment is handled after Setup Wizard.
        setResult(RESULT_OK)
        finish()
    }

    private fun persistAdminExtras() {
        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        ) ?: return

        extras.getString("serverUrl")?.takeIf { it.isNotBlank() }
            ?.let { Config.setServerUrl(this, it) }
        extras.getString("enrollmentToken")?.takeIf { it.isNotBlank() }
            ?.let { Config.setPendingEnrollmentToken(this, it) }
    }

    private companion object {
        const val TAG = "AdminPolicyCompliance"
    }
}
