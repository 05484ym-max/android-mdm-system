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
        Log.d(TAG, "Device admin enabled on ${AndroidCompatibility.label()}")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.d(TAG, "Device admin disabled")
    }

    /**
     * Completion path shared by the same APK on Android 10+.
     *
     * Android 10/11 rely on this callback as the durable hand-off after legacy
     * managed-device provisioning. Android 12+ may additionally invoke the newer
     * provisioning mode/compliance activities, but this broadcast remains a safe
     * idempotent fallback. Persist QR extras first, then schedule background work.
     */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)

        intent.getParcelableExtra<PersistableBundle>(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE
        )?.let { extras ->
            extras.getString("serverUrl")?.takeIf { it.isNotBlank() }
                ?.let { Config.setServerUrl(context, it) }
            extras.getString("enrollmentToken")?.takeIf { it.isNotBlank() }
                ?.let { Config.setPendingEnrollmentToken(context, it) }
        }

        runCatching {
            PostProvisionEnrollmentScheduler.enqueueIfPending(context.applicationContext)
        }.onFailure {
            Log.e(TAG, "Could not schedule post-provision enrollment", it)
        }

        Log.i(TAG, "Provisioning complete on ${AndroidCompatibility.label()}")
    }

    private companion object {
        const val TAG = "DpcDeviceAdmin"
    }
}
