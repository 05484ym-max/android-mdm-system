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
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) return

        val activeSession = PlayInstallGuard.activeSession(appContext)
        if (activeSession != null && changedPackage == activeSession.targetPackage) {
            PlayStoreGate.completeBecauseTargetInstalled(appContext, changedPackage)
            return
        }

        val mode = if (ManagedInstallWindow.desiredInstallBlocked(appContext)) {
            AppAccessMode.APPROVED_ONLY
        } else {
            AppAccessMode.OPEN_WITH_BLACKLIST
        }
        val shouldBlock = activeSession != null || AppAccessDecision.shouldBlock(
            packageName = changedPackage,
            mode = mode,
            allowedPackages = Config.allowedApps(appContext).toSet(),
            blockedPackages = AppAccessPolicyStore.blockedPackages(appContext),
            essentialPackages = PolicyEnforcer(appContext).essentialPackages(),
            ownPackage = appContext.packageName,
        )
        if (!shouldBlock) return

        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        var quarantined = false
        try {
            val failed = dpm.setPackagesSuspended(admin, arrayOf(changedPackage), true)
            quarantined = changedPackage !in failed
        } catch (e: Exception) {
            Log.e(TAG, "Could not suspend blocked package $changedPackage", e)
        }
        try {
            if (dpm.setApplicationHidden(admin, changedPackage, true)) quarantined = true
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide blocked package $changedPackage", e)
        }

        Config.setPolicyHiddenApps(appContext, Config.policyHiddenApps(appContext) + changedPackage)

        val replacing = intent.action == Intent.ACTION_PACKAGE_REPLACED ||
            intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)
        Log.w(
            TAG,
            "Blocked package change: $changedPackage; mode=$mode; activePlaySession=${activeSession != null}; " +
                "replacing=$replacing; quarantined=$quarantined",
        )

        if (activeSession != null) {
            PlayStoreGate.abortBecauseUnauthorizedInstall(appContext, changedPackage)
        }
    }

    companion object { private const val TAG = "PackageInstallGuard" }
}
