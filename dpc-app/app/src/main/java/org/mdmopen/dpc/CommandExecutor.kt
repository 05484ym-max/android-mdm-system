package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri

class CommandExecutor(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
    private val installer = AppInstaller(context)

    fun execute(queued: QueuedCommand, packageAttemptId: String? = null): String = when (queued.command) {
        "LOCK" -> {
            dpm.lockNow()
            "נעילה בוצעה"
        }
        "SYNC_POLICY" -> "מדיניות כבר סונכרנה במחזור הזה"
        "REBOOT" -> {
            check(PlayInstallGuard.activeSession(context) == null && !ManagedInstallWindow.isOpen(context)) {
                "אתחול נדחה: קיימת כרגע התקנה או עדכון פעילים"
            }
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
            installer.installFromUrl(apkUrl, expectedSha256, queued.id, packageAttemptId)
        }
        "UNINSTALL_APP" -> installer.uninstall(
            queued.params.getString("packageName"),
            queued.id,
            packageAttemptId,
        )
        "OPEN_PLAY_STORE_INSTALL" -> {
            val packageName = queued.params.getString("packageName")
            PlayStoreGate.openForInstall(context, packageName)
            "נפתח Play Store להתקנת $packageName"
        }
        "OPEN_PLAY_STORE_SYSTEM_COMPONENT" -> {
            val packageName = queued.params.getString("packageName")
            val displayName = queued.params.optString("displayName", packageName)
            PlayStoreGate.openForInstall(context, packageName, displayName)
            "נפתח Play Store עבור $displayName"
        }
        "OPEN_DEBUGGING_TEMP" -> {
            PolicyEnforcer(context).openDebuggingUntilNextSync()
            "ניפוי באגים נפתח זמנית עד הסנכרון הבא"
        }
        "SET_FRP_POLICY" -> {
            val accountsJson = queued.params.getJSONArray("recoveryAccounts")
            val accounts = (0 until accountsJson.length()).map { index ->
                accountsJson.getString(index)
            }
            FactoryResetProtectionManager(context).applyRecoveryAccounts(accounts)
        }
        "RELEASE_DEVICE_OWNER" -> {
            // Clear any DPC-managed FRP override before ownership is relinquished. A failure
            // here must abort release rather than strand an unmanaged device behind stale
            // enterprise recovery credentials.
            FactoryResetProtectionManager(context).clearManagedPolicyForRelease()
            PolicyEnforcer(context).releaseDeviceOwner()
            if (requestSelfUninstall()) {
                "ניהול המכשיר הוסר; Android פתח את תהליך מחיקת אפליקציית הניהול"
            } else {
                "ניהול המכשיר הוסר; לא ניתן היה לפתוח אוטומטית את מסך מחיקת אפליקציית הניהול"
            }
        }
        "ENABLE_DNS_FILTERING" -> AdBlockDns.enable(
            context,
            queued.params.getString("providerHost"),
        )
        "DISABLE_DNS_FILTERING" -> AdBlockDns.disable(context)
        else -> throw IllegalArgumentException("פקודה לא מוכרת: ${queued.command}")
    }

    private fun requestSelfUninstall(): Boolean = try {
        val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:${context.packageName}")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        true
    } catch (_: Exception) {
        false
    }
}
