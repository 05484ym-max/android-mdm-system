package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.UserManager
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import android.provider.Telephony

data class EnforcementResult(
    val suspended: List<String>,
    val unsuspended: List<String>,
    val failed: List<String>,
    val systemAppsSkipped: Int,
    val kioskEnabled: Boolean,
    // DRY-RUN only, see apply() - never suspended/hidden by this build.
    val wouldHideNoLauncher: List<NoLauncherCandidate> = emptyList(),
)

/** One package apply() found with no launcher entry that isn't essential,
 * a system app, the active keyboard, or already approved - reported so a
 * future policy change closing this gap can be sized before it's enforced. */
data class NoLauncherCandidate(val packageName: String, val label: String?)

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
        if (policy.fullOpen) return applyFullOpen()

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
        val currentImePackage = currentInputMethodPackage()
        val toSuspend = mutableListOf<String>()
        val toUnsuspend = mutableListOf<String>()
        val noLauncherCandidates = mutableListOf<NoLauncherCandidate>()
        var systemSkipped = 0

        // Migration cleanup: older DPC builds blocked apps with
        // setPackagesSuspended(). Newer builds use setApplicationHidden(), but
        // Android keeps the old suspended bit until it is explicitly cleared.
        // That leaves recovered apps visible but greyed out. Clear legacy
        // suspension for every currently-approved and essential package before
        // applying today's hidden-state policy.
        val legacyRecovered = mutableSetOf<String>()
        val recoveryPackages = (allowed + essential)
            .filter { it != context.packageName }
            .distinct()
        if (recoveryPackages.isNotEmpty()) {
            try {
                val failedRecovery = dpm.setPackagesSuspended(
                    admin,
                    recoveryPackages.toTypedArray(),
                    false
                ).toSet()
                legacyRecovered += recoveryPackages.filter { it !in failedRecovery }
            } catch (_: Exception) {
                // Hidden-state enforcement below still runs. A package that
                // cannot be addressed here will simply remain reported by the
                // normal enforcement result instead of crashing the sync.
            }
        }

        // Recover approved packages directly from DevicePolicyManager before
        // relying on PackageManager enumeration. On some Samsung builds a
        // package hidden by Device Owner can disappear from
        // getInstalledApplications(), which previously meant an approved
        // preinstalled app (for example YouTube) was never seen and therefore
        // never unhidden.
        val directlyUnhidden = mutableSetOf<String>()
        for (pkg in allowed) {
            if (pkg == context.packageName) continue
            try {
                if (dpm.isApplicationHidden(admin, pkg)) {
                    if (dpm.setApplicationHidden(admin, pkg, false)) {
                        directlyUnhidden += pkg
                    }
                }
            } catch (_: Exception) {
                // A package that is not installed (or not addressable on this
                // OEM build) is simply left for the normal install flow.
            }
        }

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
            // An approved installed app must always be explicitly unhidden first.
            // Hidden packages can stop resolving a launcher intent on some OEM builds
            // (notably Samsung), so checking getLaunchIntentForPackage() before the
            // allowlist can strand an already-installed approved app in the hidden state.
            if (app.packageName in allowed) {
                toUnsuspend += app.packageName
                continue
            }

            // Apps with no launcher entry are never visible to the customer either way -
            // suspending them only risks breaking a background system service for no gain.
            if (context.packageManager.getLaunchIntentForPackage(app.packageName) == null) {
                systemSkipped++
                // DRY-RUN only: report what a future policy closing this gap would catch,
                // without acting on it now. Never added to toSuspend/toUnsuspend below -
                // enforcement behavior in this build is unchanged. Preinstalled system
                // components (FLAG_SYSTEM) and the customer's active keyboard are never
                // reported, since hiding either carries a much bigger blast radius than
                // this dry-run is meant to size up.
                val isSystemApp = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                if (!isSystemApp && app.packageName != currentImePackage) {
                    noLauncherCandidates += NoLauncherCandidate(app.packageName, labelFor(app))
                }
                continue
            }

            toSuspend += app.packageName
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
            unsuspended = (toUnsuspend + directlyUnhidden + legacyRecovered).distinct() - failed.toSet(),
            failed = failed,
            systemAppsSkipped = systemSkipped,
            kioskEnabled = policy.kioskEnabled,
            wouldHideNoLauncher = noLauncherCandidates,
        )
    }

    private fun applyFullOpen(): EnforcementResult {
        // Reversible full-open mode: make the phone behave normally while keeping
        // Device Owner and anti-escape protections so the admin can re-apply policy remotely.
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        disableKiosk()

        val recovered = mutableListOf<String>()
        val failed = mutableListOf<String>()
        val installed = context.packageManager.getInstalledApplications(0)
            .map { it.packageName }
            .filter { it != context.packageName }
            .distinct()

        if (installed.isNotEmpty()) {
            try {
                val failedSuspended = dpm.setPackagesSuspended(admin, installed.toTypedArray(), false).toSet()
                recovered += installed.filter { it !in failedSuspended }
                failed += failedSuspended
            } catch (_: Exception) {
                // Continue with hidden-state recovery package-by-package.
            }
        }
        for (pkg in installed) {
            try {
                if (dpm.isApplicationHidden(admin, pkg) && !dpm.setApplicationHidden(admin, pkg, false)) {
                    failed += pkg
                }
            } catch (_: Exception) {
                failed += pkg
            }
        }
        return EnforcementResult(
            suspended = emptyList(),
            unsuspended = recovered.distinct() - failed.toSet(),
            failed = failed.distinct(),
            systemAppsSkipped = 0,
            kioskEnabled = false,
        )
    }

    /** The package backing the customer's currently active keyboard, or null if it
     * can't be read - resolved the same way Telephony.Sms.getDefaultSmsPackage
     * resolves the SMS role above, just for input method instead. */
    private fun currentInputMethodPackage(): String? = try {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.substringBefore('/')
            ?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }

    /** Best-effort display label for the DRY-RUN report only - never used for
     * any enforcement decision, so a lookup failure just means no label. */
    private fun labelFor(app: ApplicationInfo): String? = try {
        context.packageManager.getApplicationLabel(app).toString()
    } catch (_: Exception) {
        null
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
            "com.google.android.gms",
            "com.google.android.gsf",
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

    /**
     * Temporarily opens Developer options / ADB by clearing only the debugging
     * restriction. No other policy is changed and Device Owner remains active.
     *
     * This is intentionally temporary: apply() always re-adds
     * DISALLOW_DEBUGGING_FEATURES on the next normal policy sync.
     */
    fun openDebuggingUntilNextSync() {
        check(isDeviceOwner()) { "Not device owner" }
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
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
