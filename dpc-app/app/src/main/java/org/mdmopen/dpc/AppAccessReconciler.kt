package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.UserManager

class AppAccessReconciler(private val context: Context) {
    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    fun applyOpenWithBlacklist(blockedPackages: Set<String>): EnforcementResult {
        check(dpm.isDeviceOwnerApp(context.packageName)) { "Not device owner - cannot enforce app blacklist" }

        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        DebugMaintenanceState.setActive(context, false)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}
        PolicyEnforcer(context).disableKiosk()

        val protectedPackages = PolicyEnforcer(context).essentialPackages() + context.packageName
        val desiredBlocked = blockedPackages - protectedPackages
        val tracked = Config.policyHiddenApps(context)
        val visibleInstalled = context.packageManager.getInstalledApplications(0).map { it.packageName }
        val allKnownInstalled = try {
            context.packageManager.getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES)
                .map { it.packageName }
        } catch (_: Exception) {
            visibleInstalled
        }
        val installed = (visibleInstalled + allKnownInstalled + tracked).toSet() - context.packageName
        val toBlock = installed.intersect(desiredBlocked)
        val toRelease = tracked - toBlock - protectedPackages

        val failedBlock = mutableSetOf<String>()
        val failedRelease = mutableSetOf<String>()

        if (toBlock.isNotEmpty()) {
            try {
                failedBlock += dpm.setPackagesSuspended(admin, toBlock.toTypedArray(), true).toSet()
            } catch (_: Exception) {
                failedBlock += toBlock
            }

            for (pkg in toBlock) {
                try {
                    if (!dpm.isApplicationHidden(admin, pkg) && !dpm.setApplicationHidden(admin, pkg, true)) {
                        failedBlock += pkg
                    }
                } catch (_: Exception) {
                    failedBlock += pkg
                }
            }
        }

        if (toRelease.isNotEmpty()) {
            try {
                failedRelease += dpm.setPackagesSuspended(admin, toRelease.toTypedArray(), false).toSet()
            } catch (_: Exception) {
                failedRelease += toRelease
            }

            for (pkg in toRelease) {
                try {
                    if (dpm.isApplicationHidden(admin, pkg) && !dpm.setApplicationHidden(admin, pkg, false)) {
                        failedRelease += pkg
                    }
                } catch (_: Exception) {
                    failedRelease += pkg
                }
            }
        }

        val failed = failedBlock + failedRelease
        val successfullyBlocked = toBlock - failedBlock
        val successfullyReleased = toRelease - failedRelease
        // Keep every desired blocked package tracked even if one half of the
        // hide+suspend operation failed. A later policy change can then safely
        // retry releasing only packages this DPC attempted to manage.
        Config.setPolicyHiddenApps(
            context,
            (tracked - successfullyReleased) + toBlock,
        )

        return EnforcementResult(
            suspended = successfullyBlocked.sorted(),
            unsuspended = successfullyReleased.sorted(),
            failed = failed.sorted(),
            systemAppsSkipped = protectedPackages.size,
            kioskEnabled = false,
        )
    }
}
