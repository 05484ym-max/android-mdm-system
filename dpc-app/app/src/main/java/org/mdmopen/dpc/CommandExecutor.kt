package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context

class CommandExecutor(context: Context) {

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
        "INSTALL_APP" -> installer.installFromUrl(
            queued.params.getString("apkUrl"),
            queued.id
        )
        "UNINSTALL_APP" -> installer.uninstall(queued.params.getString("packageName"))
        else -> "פקודה לא מוכרת: ${queued.command}"
    }
}
