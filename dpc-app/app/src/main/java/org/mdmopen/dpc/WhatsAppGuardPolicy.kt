package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings

data class WhatsAppGuardPolicy(
    val blockStatuses: Boolean = false,
    val blockChannels: Boolean = false,
    val hideProfilePhotos: Boolean = false,
) {
    val enabled: Boolean get() = blockStatuses || blockChannels || hideProfilePhotos
}

enum class WhatsAppGuardDecision {
    DISABLED,
    FIRST_SETUP_PENDING,
    ACCESSIBILITY_LOST_OPEN,
    PROTECTED,
}

object WhatsAppGuardConfig {
    private const val PREFS = "whatsapp_guard_policy"
    private const val BLOCK_STATUSES = "block_statuses"
    private const val BLOCK_CHANNELS = "block_channels"
    private const val HIDE_PROFILE_PHOTOS = "hide_profile_photos"
    private const val WAS_PROTECTED = "was_protected"

    fun load(context: Context): WhatsAppGuardPolicy {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return WhatsAppGuardPolicy(
            blockStatuses = p.getBoolean(BLOCK_STATUSES, false),
            blockChannels = p.getBoolean(BLOCK_CHANNELS, false),
            hideProfilePhotos = p.getBoolean(HIDE_PROFILE_PHOTOS, false),
        )
    }

    fun save(context: Context, policy: WhatsAppGuardPolicy) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(BLOCK_STATUSES, policy.blockStatuses)
            .putBoolean(BLOCK_CHANNELS, policy.blockChannels)
            .putBoolean(HIDE_PROFILE_PHOTOS, policy.hideProfilePhotos)
            .apply()
    }

    fun wasProtected(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(WAS_PROTECTED, false)

    fun markProtected(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(WAS_PROTECTED, true)
            .apply()
    }
}

/** Device-Owner enforcement around the accessibility based WhatsApp guard. */
object WhatsAppGuardProtection {
    const val WHATSAPP_PACKAGE = "com.whatsapp"
    private const val SAMSUNG_ACCESSIBILITY_PACKAGE = "com.samsung.accessibility"

    fun decide(policyEnabled: Boolean, accessibilityEnabled: Boolean, wasProtected: Boolean): WhatsAppGuardDecision =
        when {
            !policyEnabled -> WhatsAppGuardDecision.DISABLED
            accessibilityEnabled -> WhatsAppGuardDecision.PROTECTED
            wasProtected -> WhatsAppGuardDecision.ACCESSIBILITY_LOST_OPEN
            else -> WhatsAppGuardDecision.FIRST_SETUP_PENDING
        }

    fun accessibilityEnabled(context: Context): Boolean {
        val expected = ComponentName(context, WhatsAppGuardService::class.java).flattenToString()
        val raw = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        return raw.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun approvedByOrdinaryPolicy(context: Context): Boolean =
        WHATSAPP_PACKAGE in Config.allowedApps(context)

    private fun setGuardSuspended(
        context: Context,
        dpm: DevicePolicyManager,
        admin: ComponentName,
        suspended: Boolean,
    ) {
        // Never override the ordinary app allowlist. PolicyEnforcer remains
        // authoritative for whether WhatsApp is approved/visible at all.
        if (!approvedByOrdinaryPolicy(context)) return
        runCatching {
            dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), suspended)
        }
    }

    private fun setSamsungAccessibilitySettingsVisible(
        context: Context,
        dpm: DevicePolicyManager,
        admin: ComponentName,
        visible: Boolean,
    ) {
        // Samsung/One UI delegates Accessibility Settings to this split package.
        // During first setup (or when the guard is disabled) it must remain visible
        // so Settings can open normally. Once this Guard has actually been enabled,
        // hide only that split package so a customer cannot return to the toggle and
        // switch the managed service off. Non-Samsung devices simply ignore this.
        try {
            context.packageManager.getApplicationInfo(
                SAMSUNG_ACCESSIBILITY_PACKAGE,
                PackageManager.MATCH_UNINSTALLED_PACKAGES,
            )
            dpm.setApplicationHidden(admin, SAMSUNG_ACCESSIBILITY_PACKAGE, !visible)
        } catch (_: PackageManager.NameNotFoundException) {
            // Not a Samsung build with this split package.
        } catch (_: Exception) {
            // Best effort only. WhatsApp must remain usable even if an OEM rejects
            // hiding its accessibility Settings component.
        }
    }

    /** Called after the ordinary app policy was applied. */
    fun reconcile(context: Context, policy: WhatsAppGuardPolicy): String {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return "NOT_DEVICE_OWNER"

        return when (decide(policy.enabled, accessibilityEnabled(context), WhatsAppGuardConfig.wasProtected(context))) {
            WhatsAppGuardDecision.DISABLED -> {
                setSamsungAccessibilitySettingsVisible(context, dpm, admin, true)
                setGuardSuspended(context, dpm, admin, false)
                "DISABLED"
            }
            WhatsAppGuardDecision.FIRST_SETUP_PENDING -> {
                // One-time setup only: keep Samsung Accessibility Settings reachable
                // while the user/admin enables this service locally.
                setSamsungAccessibilitySettingsVisible(context, dpm, admin, true)
                setGuardSuspended(context, dpm, admin, false)
                "WAITING_FOR_ACCESSIBILITY"
            }
            WhatsAppGuardDecision.ACCESSIBILITY_LOST_OPEN -> {
                // Fail open: if Accessibility is lost after setup, filtering is not
                // guaranteed, but WhatsApp must remain available to the customer.
                // Keep the customer out of the ordinary accessibility toggle; an admin
                // can explicitly reopen the setup window when repair is needed.
                setSamsungAccessibilitySettingsVisible(context, dpm, admin, false)
                setGuardSuspended(context, dpm, admin, false)
                "ACCESSIBILITY_LOST_OPEN"
            }
            WhatsAppGuardDecision.PROTECTED -> {
                WhatsAppGuardConfig.markProtected(context)
                // The service is confirmed ON. Lock Samsung's Accessibility Settings
                // split so the customer cannot navigate back to the service toggle.
                setSamsungAccessibilitySettingsVisible(context, dpm, admin, false)
                setGuardSuspended(context, dpm, admin, false)
                "PROTECTED"
            }
        }
    }
}
