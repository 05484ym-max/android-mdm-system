package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context

class CommandExecutor(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
    private val installer = AppInstaller(context)

    /** Runs one queued command and returns a short description of the outcome. */
    fun execute(queued: QueuedCommand): String = when (queued.command) {
        "LOCK" -> {
            dpm.lockNow()
            "נעילה בוצעה"
        }
        "SYNC_POLICY" -> "מדיניות כבר סונכרנה במחזור הזה"
        "REBOOT" -> {
            dpm.reboot(admin)
            "אתחול הופעל"
        }
        "WIPE" -> {
            dpm.wipeData(0)
            "מחיקת המכשיר הופעלה"
        }
        "INSTALL_APP" -> {
            val apkUrl = queued.params.getString("apkUrl")
            val expectedSha256 = queued.params.getString("expectedSha256")
            try {
                installer.installFromUrl(apkUrl, expectedSha256, queued.id)
            } catch (e: Exception) {
                reportInstallFailure(queued.id, e)
                throw e
            }
        }
        "UNINSTALL_APP" -> installer.uninstall(queued.params.getString("packageName"))
        "OPEN_PLAY_STORE_INSTALL" -> {
            val packageName = queued.params.getString("packageName")
            PlayStoreGate.openForInstall(context, packageName)
            "נפתח Play Store להתקנת $packageName"
        }
        "OPEN_PLAY_STORE_SYSTEM_COMPONENT" -> {
            val packageName = queued.params.getString("packageName")
            // displayName is always server-set for this command (see
            // backend/index.js's SYSTEM_COMPONENT_DISPLAY_NAMES) - falling
            // back to the raw package name only if it's ever missing.
            val displayName = queued.params.optString("displayName", packageName)
            PlayStoreGate.openForInstall(context, packageName, displayName)
            "נפתח Play Store עבור $displayName"
        }
        "RELEASE_DEVICE_OWNER" -> {
            PolicyEnforcer(context).releaseDeviceOwner()
            "ניהול המכשיר הוסר בהצלחה"
        }
        "ENABLE_DNS_FILTERING" -> {
            // providerHost is always server-set (see backend/index.js) - never
            // trusts arbitrary client-controlled params for this. enable()
            // itself records the new desired state locally on success - no
            // need to pre-set it here too (the server's own desired_state
            // columns are already updated the moment the command was queued,
            // regardless of whether applying it here succeeds or not).
            AdBlockDns.enable(context, queued.params.getString("providerHost"))
        }
        "DISABLE_DNS_FILTERING" -> {
            AdBlockDns.disable(context)
        }
        else -> "פקודה לא מוכרת: ${queued.command}"
    }

    /** Best-effort - a failed report must never crash the command loop itself;
     * the original install failure is already being propagated by the caller. */
    private fun reportInstallFailure(commandId: String, error: Exception) {
        try {
            val serverUrl = Config.serverUrl(context)
            val deviceToken = Config.deviceToken(context) ?: return
            val deviceId = Config.deviceId(context)
            ApiClient(serverUrl, deviceToken).reportCommandResult(
                deviceId, commandId, "FAILED", error.message ?: "התקנה נכשלה"
            )
        } catch (_: Exception) {
        }
    }
}
