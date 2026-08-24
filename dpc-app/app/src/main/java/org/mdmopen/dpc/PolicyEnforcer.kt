package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.os.UserManager

data class EnforcementResult(
    val suspended: List<String>,
    val unsuspended: List<String>,
    val failed: List<String>,
    val systemAppsSkipped: Int,
    val kioskEnabled: Boolean,
)

class PolicyEnforcer(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    /**
     * Suspends every non-system app that is not on the allowlist, blocks further installs,
     * and turns the kiosk home screen on or off to match the policy.
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

        val failed = (
            dpm.setPackagesSuspended(admin, toSuspend.toTypedArray(), true) +
                dpm.setPackagesSuspended(admin, toUnsuspend.toTypedArray(), false)
            ).toList()

        if (policy.kioskEnabled) enableKiosk(allowed) else disableKiosk()

        return EnforcementResult(
            suspended = toSuspend - failed.toSet(),
            unsuspended = toUnsuspend - failed.toSet(),
            failed = failed,
            systemAppsSkipped = systemSkipped,
            kioskEnabled = policy.kioskEnabled,
        )
    }

    private fun enableKiosk(allowed: Set<String>) {
        dpm.setLockTaskPackages(admin, (allowed + context.packageName).toTypedArray())
        dpm.setLockTaskFeatures(
            admin,
            DevicePolicyManager.LOCK_TASK_FEATURE_HOME or
                DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or
                DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or
                DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD,
        )
        val homeFilter = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        dpm.addPersistentPreferredActivity(
            admin,
            homeFilter,
            ComponentName(context, KioskLauncherActivity::class.java),
        )
    }

    /** Also used as a local escape hatch from the admin screen. */
    fun disableKiosk() {
        dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
        dpm.setLockTaskPackages(admin, emptyArray())
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
    }
}
