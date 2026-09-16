package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

class PackageInstallGuardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED && intent.action != Intent.ACTION_PACKAGE_REPLACED) return
        val changedPackage = intent.data?.schemeSpecificPart?.takeIf { it.isNotBlank() } ?: return
        val session = PlayInstallGuard.activeSession(context) ?: return

        if (changedPackage == session.targetPackage) {
            PlayStoreGate.completeBecauseTargetInstalled(context, changedPackage)
            return
        }

        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) {
            PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, changedPackage)
            return
        }

        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        var quarantined = false
        try {
            dpm.setPackagesSuspended(admin, arrayOf(changedPackage), true)
            quarantined = true
        } catch (e: Exception) {
            Log.e(TAG, "Could not suspend unauthorized package $changedPackage", e)
        }
        try {
            if (dpm.setApplicationHidden(admin, changedPackage, true)) quarantined = true
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide unauthorized package $changedPackage", e)
        }

        val replacing = intent.action == Intent.ACTION_PACKAGE_REPLACED || intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
        Log.w(TAG, "Unauthorized package changed during Play session: $changedPackage; target=${session.targetPackage}; replacing=$replacing; quarantined=$quarantined")
        PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, changedPackage)
    }

    companion object { private const val TAG = "PackageInstallGuard" }
}
