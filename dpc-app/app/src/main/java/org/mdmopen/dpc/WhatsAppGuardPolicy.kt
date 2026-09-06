package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.UserManager
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
 * Android does not let a normal DPC silently enable an AccessibilityService.
 * Therefore the first enable is a one-time local action. After it is enabled,
 * Device Owner locks accessibility configuration so the customer cannot simply
 * turn the guard off. Until that first enable happens, WhatsApp itself is
 * suspended: fail closed instead of presenting an unfiltered WhatsApp window.
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

        val enabled = accessibilityEnabled(context)
        if (!policy.enabled) {
            // Do not leave the whole Accessibility settings page locked after the
            // administrator has disabled every WhatsApp protection.
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_CONFIG_ACCESSIBILITY) }
            return "DISABLED"
        }

        if (!enabled) {
            // The admin/customer must still be able to perform the one-time
            // accessibility enable, so do not apply DISALLOW_CONFIG_ACCESSIBILITY yet.
            runCatching { dpm.clearUserRestriction(admin, UserManager.DISALLOW_CONFIG_ACCESSIBILITY) }
            runCatching { dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), true) }
            return "WAITING_FOR_ACCESSIBILITY"
        }

        // Once the service is genuinely enabled, lock the relevant settings so
        // disabling Accessibility is no longer a bypass path on managed devices.
        runCatching { dpm.addUserRestriction(admin, UserManager.DISALLOW_CONFIG_ACCESSIBILITY) }

        // PolicyEnforcer normally unsuspends approved apps. This also closes the
        // short setup gap immediately after the AccessibilityService connects.
        if (WHATSAPP_PACKAGE in Config.allowedApps(context)) {
            runCatching { dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), false) }
        }
        return "PROTECTED"
    }
}
