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
        // A background sync landing mid-install (PlayStoreGate's window still open)
        // must not re-clamp this out from under a Play Store install in progress.
        if (PlayStoreGate.isWindowClosed(context)) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        }
        // The customer can remove any app they can see - our own app is a
        // Device Owner app, which Android already refuses to let anyone
        // uninstall through the normal flow regardless of this restriction.
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        // Without these, the customer can sidestep every restriction above:
        // enabling USB debugging lets adb start any exported activity
        // directly (bypassing in-app PIN checks entirely), and Safe Mode
        // disables every non-system app - including this one - taking the
        // whole kiosk/allowlist enforcement down with it.
        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)

        val allowed = policy.allowedApps.toSet() + playStoreTemporaryAllowance()
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

        // Hidden (not merely suspended) so unapproved apps disappear from the
        // launcher entirely instead of showing as a greyed-out icon.
        val failed = mutableListOf<String>()
        for (pkg in toSuspend) {
            if (!dpm.setApplicationHidden(admin, pkg, true)) failed += pkg
        }
        for (pkg in toUnsuspend) {
            if (!dpm.setApplicationHidden(admin, pkg, false)) failed += pkg
        }

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
    fun essentialPackages(): Set<String> {
        val essential = mutableSetOf(context.packageName, "com.android.settings")
        val pm = context.packageManager

        fun addResolved(intent: Intent) {
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                ?.activityInfo?.packageName?.let { essential += it }
        }

        addResolved(Intent(Intent.ACTION_DIAL))

        // Every launcher installed, not just whichever currently resolves as
        // default - during kiosk mode that default is this app itself, which
        // would otherwise leave the phone's real home screen unprotected and
        // suspended like any other unapproved app, with no way back once
        // kiosk mode turns off again.
        val homeIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        pm.queryIntentActivities(homeIntent, PackageManager.MATCH_ALL)
            .forEach { essential += it.activityInfo.packageName }

        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CONTACTS))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_EMAIL))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY))
        addResolved(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR))
        addResolved(Intent(AlarmClock.ACTION_SHOW_ALARMS))
        addResolved(Intent(MediaStore.ACTION_IMAGE_CAPTURE))

        Telephony.Sms.getDefaultSmsPackage(context)?.let { essential += it }

        // Samsung's own apps often don't answer the standard role intents above
        // (no default set, or the category isn't declared at all), so the dynamic
        // resolution above silently misses them. Back it up with known package
        // names across Samsung/AOSP - harmless if a name isn't installed.
        val knownUtilityApps = listOf(
            "com.sec.android.app.launcher",
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
            "com.sec.android.app.voicenote",
            "com.samsung.android.app.voicenote",
            "com.sec.android.app.popupcalculator",
            "com.google.android.calculator",
        )
        val installed = pm.getInstalledApplications(0).map { it.packageName }.toSet()
        essential += knownUtilityApps.filter { it in installed }

        return essential
    }

    /**
     * Play Store is hidden by default like any unapproved app. PlayStoreGate
     * briefly opens a window (recorded here as an expiry timestamp) while an
     * admin-approved install is in progress - this is what keeps it unhidden
     * for that window on every policy pass in the meantime.
     */
    private fun playStoreTemporaryAllowance(): Set<String> =
        if (!PlayStoreGate.isWindowClosed(context)) setOf("com.android.vending") else emptySet()

    private fun enableKiosk(allowed: Set<String>) {
        // Without the essentials, a customer with nothing approved yet (or
        // whose approved apps aren't installed) gets locked into a kiosk
        // screen with literally nothing reachable - not even Settings.
        dpm.setLockTaskPackages(admin, (allowed + essentialPackages() + context.packageName).toTypedArray())
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
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)

        // Release Device Owner ownership.
        dpm.clearDeviceOwnerApp(context.packageName)
    }
}
