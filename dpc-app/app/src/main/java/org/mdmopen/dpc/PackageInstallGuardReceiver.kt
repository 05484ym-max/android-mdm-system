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
            // Without Device Owner we cannot safely quarantine/remove a package.
            // Fail closed rather than leaving an unprotected Play install window.
            PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, changedPackage)
            return
        }

        val replacing = intent.action == Intent.ACTION_PACKAGE_REPLACED ||
            intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)

        // Do not disturb Play just because another already-installed app updated in
        // the background while the approved install window is open.
        if (replacing) {
            Log.i(
                TAG,
                "Non-target existing package updated during Play session: $changedPackage; target=${session.targetPackage}"
            )
            return
        }

        // A brand-new non-target package is not allowed. Keep the approved Play
        // session open, but quarantine the unwanted app immediately and request
        // its removal. This keeps the customer's install flow visible and simple.
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

        Log.w(
            TAG,
            "Removing unauthorized package installed during Play session: $changedPackage; target=${session.targetPackage}; quarantined=$quarantined"
        )
        runCatching { AppInstaller(appContext).uninstall(changedPackage) }
            .onFailure { Log.e(TAG, "Could not request removal of unauthorized package $changedPackage", it) }
    }

    companion object { private const val TAG = "PackageInstallGuard" }
}
