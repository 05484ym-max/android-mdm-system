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
        Log.d(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.d(TAG, "Device admin disabled")
    }

    /**
     * Fires once provisioning succeeds. Stores whatever the QR carried so the
     * compliance screen can enrol without the installer typing anything.
     */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)

        val extras = intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        ) ?: return

        extras.getString("serverUrl")?.takeIf { it.isNotBlank() }
            ?.let { Config.setServerUrl(context, it) }
        extras.getString("enrollmentToken")?.takeIf { it.isNotBlank() }
            ?.let { Config.setPendingEnrollmentToken(context, it) }

        Log.i(TAG, "Provisioning extras stored")
    }

    private companion object {
        const val TAG = "DpcDeviceAdmin"
    }
}
