package org.mdmopen.dpc

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Android 12+ admin-integrated provisioning mode callback.
 *
 * Keep this callback deliberately tiny and deterministic. The QR flow is for a
 * fully-managed Device Owner, so we return only that mode and never run network,
 * policy, WorkManager or UI work while Setup Wizard is waiting for the result.
 */
class GetProvisioningModeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (intent.action != DevicePolicyManager.ACTION_GET_PROVISIONING_MODE) {
            Log.e(TAG, "Unexpected action: ${intent.action}")
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        val allowed = intent.getIntegerArrayListExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES
        )
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE

        // TestDPC treats a missing/empty list as supporting the normal DO/PO
        // choices. For our product the QR path is DO-only, so missing/empty is
        // valid and maps directly to fully-managed device mode.
        if (!allowed.isNullOrEmpty() && !allowed.contains(fullyManaged)) {
            Log.e(TAG, "Setup Wizard explicitly did not allow fully-managed mode: $allowed")
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        Log.i(TAG, "Returning fully-managed provisioning mode; allowed=$allowed")
        setResult(
            RESULT_OK,
            Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, fullyManaged),
        )
        finish()
    }

    private companion object {
        const val TAG = "GetProvisioningMode"
    }
}
