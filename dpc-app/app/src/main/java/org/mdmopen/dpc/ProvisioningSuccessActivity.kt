package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.os.Bundle
import android.util.Log

/**
 * Finalization hook delivered only to the newly provisioned device/profile owner.
 * Keep it side-effect-light: durable enrollment/policy work is scheduled after
 * Setup Wizard hands ownership to the DPC instead of blocking provisioning.
 */
class ProvisioningSuccessActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (intent.action == DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL) {
            Log.i(TAG, "Provisioning successful; scheduling post-provision enrollment")
            runCatching {
                PostProvisionEnrollmentScheduler.enqueueIfPending(applicationContext)
            }.onFailure {
                Log.e(TAG, "Could not schedule post-provision enrollment", it)
            }
        }

        finish()
    }

    private companion object {
        const val TAG = "ProvisioningSuccess"
    }
}
