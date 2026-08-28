package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.UserManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Telephony

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
        dpm.addUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)

        val allowed = policy.allowedApps.toSet()
        val essential = essentialPackages()
        val toSuspend = mutableListOf<String>()
        val toUnsuspend = mutableListOf<String>()
        var systemSkipped = 0

        for (app in context.packageManager.getInstalledApplications(0)) {
            if (app.packageName == context.packageName) continue
            if (app.packageName in essential) {
                systemSkipped++
                // Explicitly unsuspend rather than just skipping, so an app that got
                // wrongly suspended before it was added to this list recovers on the
                // next sync instead of staying suspended forever.
                toUnsuspend += app.packageName
                continue
            }
            // Apps with no launcher entry are never visible to the customer either way -
            // suspending them only risks breaking a background system service for no gain.
            if (context.packageManager.getLaunchIntentForPackage(app.packageName) == null) {
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

    /**
     * Packages that must stay usable no matter what's approved: basic phone functions
     * (settings, dialer, SMS, home) plus everyday device tools (contacts, clock,
     * calendar, camera, gallery, files, mail) - resolved dynamically by system role
     * rather than hardcoded OEM package names, since those vary by manufacturer.
     * Suspending anything else the customer can see (including preinstalled
     * Google/social apps) is intentional.
     */
    private fun essentialPackages(): Set<String> {
        val essential = mutableSetOf(context.packageName, "com.android.settings")
        val pm = context.packageManager

        fun addResolved(intent: Intent) {
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                ?.activityInfo?.packageName?.let { essential += it }
        }

        addResolved(Intent(Intent.ACTION_DIAL))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CONTACTS))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_EMAIL))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY))
        addResolved(Intent(AlarmClock.ACTION_SHOW_ALARMS))
        addResolved(Intent(MediaStore.ACTION_IMAGE_CAPTURE))

        Telephony.Sms.getDefaultSmsPackage(context)?.let { essential += it }

        // Samsung's own apps often don't answer the standard role intents above
        // (no default set, or the category isn't declared at all), so the dynamic
        // resolution above silently misses them. Back it up with known package
        // names across Samsung/AOSP - harmless if a name isn't installed.
        val knownUtilityApps = listOf(
            "com.sec.android.app.myfiles",
            "com.google.android.documentsui",
            "com.android.documentsui",
            "com.sec.android.app.camera",
            "com.sec.android.gallery3d",
            "com.samsung.android.gallery",
            "com.sec.android.app.clockpackage",
            "com.samsung.android.calendar",
            "com.samsung.android.app.contacts",
            "com.android.contacts",
            "com.samsung.android.email.provider",
            "com.samsung.android.dialer",
            "com.samsung.android.messaging",
        )
        val installed = pm.getInstalledApplications(0).map { it.packageName }.toSet()
        essential += knownUtilityApps.filter { it in installed }

        return essential
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

    fun releaseDeviceOwner() {
        check(isDeviceOwner()) { "Not device owner" }

        // Remove kiosk controls first.
        disableKiosk()

        // Remove restrictions we applied.
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)

        // Release Device Owner ownership.
        dpm.clearDeviceOwnerApp(context.packageName)
    }
}
