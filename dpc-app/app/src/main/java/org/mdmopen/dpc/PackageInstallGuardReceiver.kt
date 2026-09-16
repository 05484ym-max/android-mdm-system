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
 * Google Play can install or update the one package the customer selected,
 * Android does not provide a package-scoped variant of that restriction.
 * We therefore watch both fresh installs and package replacements during the
 * guarded window. Anything other than the exact requested package is
 * immediately suspended + hidden, the Play window is closed, and the normal
 * install restriction is restored.
 *
 * Important: a preinstalled/system app (for example Google Photos on some
 * Samsung builds) can be "installed" from Play as a package replacement. The
 * old guard ignored EXTRA_REPLACING, which left that path open.
 */
class PackageInstallGuardReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_ADDED &&
            intent.action != Intent.ACTION_PACKAGE_REPLACED
        ) return

        val changedPackage = intent.data?.schemeSpecificPart?.takeIf { it.isNotBlank() } ?: return
        val session = PlayInstallGuard.activeSession(context) ?: return

        // The exact package requested by the customer is allowed whether this
        // event represents a first install or an update/replacement.
        if (changedPackage == session.targetPackage) return

        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) return

        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        var quarantined = false

        try {
            dpm.setPackagesSuspended(admin, arrayOf(changedPackage), true)
            quarantined = true
        } catch (e: Exception) {
            Log.e(TAG, "Could not suspend unauthorized package $changedPackage", e)
        }

        try {
            if (dpm.setApplicationHidden(admin, changedPackage, true)) {
                quarantined = true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide unauthorized package $changedPackage", e)
        }

        val replacing = intent.action == Intent.ACTION_PACKAGE_REPLACED ||
            intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
        Log.w(
            TAG,
            "Unauthorized package changed during Play session: $changedPackage; " +
                "target=${session.targetPackage}; replacing=$replacing; quarantined=$quarantined",
        )

        PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, changedPackage)
    }

    companion object {
        private const val TAG = "PackageInstallGuard"
    }
}
