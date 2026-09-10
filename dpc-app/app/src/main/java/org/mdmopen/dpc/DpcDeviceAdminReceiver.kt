package org.mdmopen.dpc

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.util.Log

class DpcDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        runCatching { ResetProtection.enforce(context) }
            .onFailure { Log.w(TAG, "Reset protection check after admin enable failed", it) }
        Log.d(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.d(TAG, "Device admin disabled")
    }

    /**
     * Fires once provisioning succeeds. Anti-reset state is asserted immediately,
     * even when no optional QR extras were supplied, then enrollment extras are
     * stored when present.
     */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)

        runCatching { ResetProtection.enforce(context) }
            .onFailure { Log.w(TAG, "Reset protection after provisioning failed", it) }

        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        )

        extras?.getString("serverUrl")?.takeIf { it.isNotBlank() }
            ?.let { Config.setServerUrl(context, it) }
        extras?.getString("enrollmentToken")?.takeIf { it.isNotBlank() }
            ?.let { Config.setPendingEnrollmentToken(context, it) }

        Log.i(TAG, "Provisioning complete; reset protection asserted")
    }

    private companion object {
        const val TAG = "DpcDeviceAdmin"
    }
}
