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
    val wouldHideNoLauncher: List<NoLauncherCandidate> = emptyList(),
)

data class NoLauncherCandidate(val packageName: String, val label: String?)

class PolicyEnforcer(private val context: Context) {

    private val dpm =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    fun apply(policy: Policy): EnforcementResult {
        check(isDeviceOwner()) { "Not device owner - cannot enforce policy" }
        if (policy.fullOpen) return applyFullOpen()

        dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        // Do not re-clamp installation while either an approved Play Store window
        // or a silent managed PackageInstaller session is still in progress.
        if (PlayStoreGate.isWindowClosed(context) && !ManagedInstallWindow.isOpen(context)) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        }
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        DebugMaintenanceState.setActive(context, false)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)

        allowManagedAccessibilityService()

        val allowed = policy.allowedApps.toSet() + playStoreTemporaryAllowance()
        val essential = essentialPackages()
        val currentImePackage = currentInputMethodPackage()
        val toSuspend = mutableListOf<String>()
        val toUnsuspend = mutableListOf<String>()
        val noLauncherCandidates = mutableListOf<NoLauncherCandidate>()
        var systemSkipped = 0

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
            }
        }

        val directlyUnhidden = mutableSetOf<String>()
        for (pkg in (allowed + essential)) {
            if (pkg == context.packageName) continue
            try {
                if (dpm.isApplicationHidden(admin, pkg)) {
                    if (dpm.setApplicationHidden(admin, pkg, false)) {
                        directlyUnhidden += pkg
                    }
                }
            } catch (_: Exception) {
            }
        }

        for (app in context.packageManager.getInstalledApplications(0)) {
            if (app.packageName == context.packageName) continue
            if (app.packageName in essential) {
                systemSkipped++
                toUnsuspend += app.packageName
                continue
            }
            if (app.packageName in allowed) {
                toUnsuspend += app.packageName
                continue
            }

            if (context.packageManager.getLaunchIntentForPackage(app.packageName) == null) {
                systemSkipped++
                val isSystemApp = (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                if (!isSystemApp && app.packageName != currentImePackage) {
                    noLauncherCandidates += NoLauncherCandidate(app.packageName, labelFor(app))
                }
                continue
            }

            toSuspend += app.packageName
        }

        val failed = mutableListOf<String>()

        fun applyHiddenStateIfNeeded(pkg: String, shouldHide: Boolean) {
            try {
                if (dpm.isApplicationHidden(admin, pkg) == shouldHide) return
                if (!dpm.setApplicationHidden(admin, pkg, shouldHide)) failed += pkg
            } catch (_: Exception) {
                failed += pkg
            }
        }

        for (pkg in toSuspend) {
            applyHiddenStateIfNeeded(pkg, true)
        }
        for (pkg in toUnsuspend) {
            applyHiddenStateIfNeeded(pkg, false)
        }

        val successfullyHidden = (toSuspend - failed.toSet()).toSet()
        val stillTracked = (Config.policyHiddenApps(context) + successfullyHidden) - toUnsuspend.toSet()
        Config.setPolicyHiddenApps(context, stillTracked)

        val setupActive = Config.accessibilitySetupWindowActive(context)
        val effectiveKiosk = policy.kioskEnabled && !setupActive
        if (effectiveKiosk) enableKiosk(allowed) else disableKiosk()

        return EnforcementResult(
            suspended = toSuspend - failed.toSet(),
            unsuspended = (toUnsuspend + directlyUnhidden + legacyRecovered).distinct() - failed.toSet(),
            failed = failed,
            systemAppsSkipped = systemSkipped,
            kioskEnabled = effectiveKiosk,
            wouldHideNoLauncher = noLauncherCandidates,
        )
    }

    fun allowManagedAccessibilityService(force: Boolean = false) {
        check(isDeviceOwner()) { "Not device owner" }
        val setupActive = Config.accessibilitySetupWindowActive(context)
        if (!AccessibilitySetupWindow.shouldRestoreAllowlist(setupActive, force)) return
        try {
            dpm.setPermittedAccessibilityServices(admin, listOf(context.packageName))
        } catch (_: Exception) {
        }
    }

    fun beginAccessibilitySetupWindow() {
        check(isDeviceOwner()) { "Not device owner" }
        Config.setAccessibilitySetupWindowActive(context, true)

        try { dpm.setUninstallBlocked(admin, context.packageName, true) } catch (_: Exception) {}
        try { dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET) } catch (_: Exception) {}
        if (!DebugMaintenanceState.isActive(context)) {
            try { dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) } catch (_: Exception) {}
        } else {
            try { dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) } catch (_: Exception) {}
        }
        try { dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) } catch (_: Exception) {}

        disableKiosk()
        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}
        SyncScheduler.enqueueAccessibilityRelock(context)
    }

    fun markAccessibilitySetupComplete() {
        check(isDeviceOwner()) { "Not device owner" }
        Config.setAccessibilitySetupWindowActive(context, false)
        allowManagedAccessibilityService(force = true)
        restoreCachedKioskPolicy()
    }

    fun finishAccessibilitySetupWindow() {
        check(isDeviceOwner()) { "Not device owner" }
        if (Config.accessibilitySetupWindowActive(context) &&
            !WhatsAppGuardProtection.accessibilityEnabled(context)
        ) {
            disableKiosk()
            return
        }

        Config.setAccessibilitySetupWindowActive(context, false)
        allowManagedAccessibilityService(force = true)
        try { dpm.setUninstallBlocked(admin, context.packageName, true) } catch (_: Exception) {}
        restoreCachedKioskPolicy()
    }

    private fun applyFullOpen(): EnforcementResult {
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        DebugMaintenanceState.setActive(context, false)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        try { dpm.setPermittedAccessibilityServices(admin, null) } catch (_: Exception) {}
        disableKiosk()

        // Include packages that the device owner marked hidden without treating
        // genuinely removed packages as a release failure.
        val pm = context.packageManager
        val previouslyHidden = Config.policyHiddenApps(context)
        val normalPackages = pm.getInstalledApplications(0).map { it.packageName }.toSet()
        val additionalPackages = pm.getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES)
            .map { it.packageName }
        val installed = (normalPackages + additionalPackages + previouslyHidden)
            .filter { pkg ->
                pkg != context.packageName && (
                    pkg in normalPackages ||
                    runCatching { dpm.isApplicationHidden(admin, pkg) }.getOrDefault(false)
                )
            }.distinct()

        val failed = mutableSetOf<String>()
        val recovered = mutableSetOf<String>()

        // Restore hidden packages FIRST, so PackageManager can inspect their suspension.
        for (pkg in installed) {
            try {
                if (dpm.isApplicationHidden(admin, pkg)) {
                    if (dpm.setApplicationHidden(admin, pkg, false)) recovered += pkg
                    else failed += pkg
                }
            } catch (_: Exception) {
                if (pkg in previouslyHidden) failed += pkg
            }
        }

        // Unsuspend only packages Android reports as suspended, not every system package.
        // Android can legitimately refuse setPackagesSuspended(false) for non-suspendable
        // system packages, even when they were never blocked.
        val suspended = installed.filter { pkg ->
            try {
                pm.isPackageSuspended(pkg)
            } catch (_: Exception) {
                if (pkg in previouslyHidden) failed += pkg
                false
            }
        }
        if (suspended.isNotEmpty()) {
            try {
                dpm.setPackagesSuspended(admin, suspended.toTypedArray(), false)
            } catch (_: Exception) {
                failed += suspended
            }
        }

        // The platform state, not the setter return value, determines release safety.
        for (pkg in installed) {
            try {
                if (dpm.isApplicationHidden(admin, pkg) || pm.isPackageSuspended(pkg)) {
                    failed += pkg
                } else if (pkg in suspended || pkg in previouslyHidden) {
                    recovered += pkg
                }
            } catch (_: Exception) {
                if (pkg in suspended || pkg in previouslyHidden) failed += pkg
            }
        }
        Config.setPolicyHiddenApps(context, previouslyHidden.intersect(failed))
        return EnforcementResult(
            suspended = emptyList(),
            unsuspended = (recovered - failed).toList(),
            failed = failed.toList(),
            systemAppsSkipped = 0,
            kioskEnabled = false,
        )
    }

    private fun currentInputMethodPackage(): String? = try {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.substringBefore('/')
            ?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }

    private fun labelFor(app: ApplicationInfo): String? = try {
        context.packageManager.getApplicationLabel(app).toString()
    } catch (_: Exception) {
        null
    }

    fun essentialPackages(): Set<String> {
        val essential = mutableSetOf(context.packageName, "com.android.settings")
        val pm = context.packageManager

        val samsungAccessibilityPackage = "com.samsung.accessibility"
        try {
            pm.getApplicationInfo(samsungAccessibilityPackage, PackageManager.MATCH_UNINSTALLED_PACKAGES)
            essential += samsungAccessibilityPackage
        } catch (_: PackageManager.NameNotFoundException) {
        }

        fun addResolved(intent: Intent) {
            pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
                ?.activityInfo?.packageName?.let { essential += it }
        }

        addResolved(Intent(Intent.ACTION_DIAL))

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

    private fun playStoreTemporaryAllowance(): Set<String> =
        if (!PlayStoreGate.isWindowClosed(context)) setOf("com.android.vending") else emptySet()

    private fun enableKiosk(allowed: Set<String>) {
        if (Config.accessibilitySetupWindowActive(context)) {
            disableKiosk()
            return
        }

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

    fun openDebuggingUntilNextSync() {
        check(isDeviceOwner()) { "Not device owner" }
        DebugMaintenanceState.setActive(context, true)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
    }

    fun restoreCachedKioskPolicy() {
        check(isDeviceOwner()) { "Not device owner" }
        if (Config.accessibilitySetupWindowActive(context)) {
            disableKiosk()
            return
        }
        if (Config.kioskEnabled(context)) {
            enableKiosk(Config.allowedApps(context).toSet() + playStoreTemporaryAllowance())
        } else {
            disableKiosk()
        }
    }

    fun disableKiosk() {
        dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
        dpm.setLockTaskPackages(admin, emptyArray())
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
    }

    fun releaseDeviceOwner() {
        check(isDeviceOwner()) { "Not device owner" }
        val recovery = applyFullOpen()
        check(recovery.failed.isEmpty()) {
            "Cannot safely release device owner; failed to recover: ${recovery.failed.joinToString(",")}" 
        }

        // Device Owner is the last chance to change managed Private DNS. Do not
        // relinquish ownership unless the live platform state proves filtering is gone.
        val dnsMessage = try {
            AdBlockDns.disable(context)
        } catch (e: Exception) {
            throw IllegalStateException("Cannot safely disable managed DNS before release", e)
        }
        val dnsModeAfterDisable = AdBlockDns.currentMode(context)
        check(dnsModeAfterDisable == DnsMode.OPPORTUNISTIC || dnsModeAfterDisable == DnsMode.OFF) {
            "Cannot safely release device owner; managed DNS did not clear ($dnsModeAfterDisable): $dnsMessage"
        }

        // Release is irreversible: turn off the independently running accessibility
        // guard and its watchdog before giving up Device Owner privileges.
        WhatsAppGuardConfig.save(context, WhatsAppGuardPolicy())
        WhatsAppGuardWatchdogScheduler.reconcileSchedule(context)
        check(WhatsAppGuardProtection.reconcile(context, WhatsAppGuardPolicy()) == "DISABLED") {
            "Cannot disable WhatsApp Guard before releasing Device Owner"
        }

        ManagedInstallWindow.forceClose(context)
        disableKiosk()
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT)
        try {
            dpm.setUninstallBlocked(admin, context.packageName, false)
        } catch (_: Exception) {
        }

        dpm.clearDeviceOwnerApp(context.packageName)
        check(!isDeviceOwner()) { "Device Owner still active after release" }
    }
}
