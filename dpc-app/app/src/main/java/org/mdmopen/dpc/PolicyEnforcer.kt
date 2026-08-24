package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.UserManager

data class EnforcementResult(
    val suspended: List<String>,
    val unsuspended: List<String>,
    val failed: List<String>,
    val systemAppsSkipped: Int,
)

class PolicyEnforcer(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    /**
     * Applies the allowlist: every non-system app that is not on the list is suspended,
     * every app on the list is un-suspended. Also blocks all further app installs so the
     * DPC stays the only way apps reach the device.
     */
    fun apply(policy: Policy): EnforcementResult {
        check(isDeviceOwner()) { "Not device owner - cannot enforce policy" }

        dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)

        val allowed = policy.allowedApps.toSet()
        val toSuspend = mutableListOf<String>()
        val toUnsuspend = mutableListOf<String>()
        var systemSkipped = 0

        for (app in context.packageManager.getInstalledApplications(0)) {
            if (app.packageName == context.packageName) continue
            if ((app.flags and ApplicationInfo.FLAG_SYSTEM) != 0) {
                systemSkipped++
                continue
            }
            if (app.packageName in allowed) toUnsuspend += app.packageName
            else toSuspend += app.packageName
        }

        val failedSuspend = dpm.setPackagesSuspended(admin, toSuspend.toTypedArray(), true)
        val failedUnsuspend = dpm.setPackagesSuspended(admin, toUnsuspend.toTypedArray(), false)
        val failed = (failedSuspend + failedUnsuspend).toList()

        return EnforcementResult(
            suspended = toSuspend - failed.toSet(),
            unsuspended = toUnsuspend - failed.toSet(),
            failed = failed,
            systemAppsSkipped = systemSkipped,
        )
    }
}
