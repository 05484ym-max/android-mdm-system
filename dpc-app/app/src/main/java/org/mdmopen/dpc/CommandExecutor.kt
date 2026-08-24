package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context

class CommandExecutor(context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    /** Runs one queued command and returns a short description of the outcome. */
    fun execute(command: String): String = when (command) {
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
        else -> "פקודה לא מוכרת: $command"
    }
}
