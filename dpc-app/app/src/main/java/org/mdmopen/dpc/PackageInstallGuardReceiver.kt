package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Defense-in-depth for the short Google Play install window.
 *
 * Android's DISALLOW_INSTALL_APPS restriction is global: when it is lifted so
 * Google Play can install the one package the customer selected, Android does
 * not provide a package-scoped variant of that restriction. We therefore watch
 * for newly-added packages during the guarded window. Anything other than the
 * exact requested package is immediately suspended + hidden, the Play window is
 * closed, and the normal install restriction is restored.
 */
class PackageInstallGuardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED) return
        if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return

        val installedPackage = intent.data?.schemeSpecificPart?.takeIf { it.isNotBlank() } ?: return
        val session = PlayInstallGuard.activeSession(context) ?: return
        if (installedPackage == session.targetPackage) return

        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) return

        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        var quarantined = false

        try {
            dpm.setPackagesSuspended(admin, arrayOf(installedPackage), true)
            quarantined = true
        } catch (e: Exception) {
            Log.e(TAG, "Could not suspend unauthorized package $installedPackage", e)
        }

        try {
            if (dpm.setApplicationHidden(admin, installedPackage, true)) {
                quarantined = true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide unauthorized package $installedPackage", e)
        }

        Log.w(
            TAG,
            "Unauthorized package installed during Play session: $installedPackage; " +
                "target=${session.targetPackage}; quarantined=$quarantined",
        )

        PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, installedPackage)
    }

    companion object {
        private const val TAG = "PackageInstallGuard"
    }
}
