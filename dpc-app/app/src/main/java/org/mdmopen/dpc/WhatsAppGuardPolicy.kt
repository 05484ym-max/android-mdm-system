package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.provider.Settings

data class WhatsAppGuardPolicy(
    val blockStatuses: Boolean = false,
    val blockChannels: Boolean = false,
    val hideProfilePhotos: Boolean = false,
) {
    val enabled: Boolean get() = blockStatuses || blockChannels || hideProfilePhotos
}

object WhatsAppGuardConfig {
    private const val PREFS = "whatsapp_guard_policy"
    private const val BLOCK_STATUSES = "block_statuses"
    private const val BLOCK_CHANNELS = "block_channels"
    private const val HIDE_PROFILE_PHOTOS = "hide_profile_photos"

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
}

/**
 * Device-Owner enforcement around the accessibility based WhatsApp guard.
 *
 * Android does not provide a supported Device Owner API that silently enables
 * an AccessibilityService, so the first enable remains a one-time local action.
 * The security rule is fail closed: whenever any WhatsApp guard rule is requested
 * and the service is not actually enabled, WhatsApp itself is suspended instead
 * of being left available without filtering.
 */
object WhatsAppGuardProtection {
    const val WHATSAPP_PACKAGE = "com.whatsapp"

    fun accessibilityEnabled(context: Context): Boolean {
        val expected = ComponentName(context, WhatsAppGuardService::class.java).flattenToString()
        val raw = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        return raw.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    /** Called after the ordinary app policy was applied. */
    fun reconcile(context: Context, policy: WhatsAppGuardPolicy): String {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return "NOT_DEVICE_OWNER"

        if (!policy.enabled) {
            // The ordinary PolicyEnforcer remains authoritative when WhatsApp
            // guard is disabled. It has already applied the app allow/suspend
            // policy before this method is called.
            return "DISABLED"
        }

        if (!accessibilityEnabled(context)) {
            runCatching {
                dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), true)
            }
            return "WAITING_FOR_ACCESSIBILITY"
        }

        // PolicyEnforcer normally releases approved apps. Releasing here too
        // closes the setup transition immediately when Accessibility connects.
        // Never release WhatsApp if it is not approved in the ordinary app policy.
        if (WHATSAPP_PACKAGE in Config.allowedApps(context)) {
            runCatching {
                dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), false)
            }
        }
        return "PROTECTED"
    }
}
