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
 * Device-Owner enforcement around the optional accessibility based WhatsApp guard.
 *
 * Android does not provide a supported Device Owner API that silently enables
 * an AccessibilityService, so the first enable remains a one-time local action.
 * WhatsApp itself must stay usable while the optional guard is disabled, and it
 * must also stay usable while the requested guard is waiting for Accessibility.
 * The admin UI reports that pending state until the service is enabled.
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

    private fun releaseLegacyGuardSuspension(
        context: Context,
        dpm: DevicePolicyManager,
        admin: ComponentName,
    ) {
        // Never override the ordinary app allowlist. Only release WhatsApp when
        // it is already approved there; otherwise PolicyEnforcer remains authoritative.
        if (WHATSAPP_PACKAGE !in Config.allowedApps(context)) return
        runCatching {
            dpm.setPackagesSuspended(admin, arrayOf(WHATSAPP_PACKAGE), false)
        }
    }

    /** Called after the ordinary app policy was applied. */
    fun reconcile(context: Context, policy: WhatsAppGuardPolicy): String {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return "NOT_DEVICE_OWNER"

        if (!policy.enabled) {
            // Recover devices that were suspended by the previous fail-closed
            // WhatsApp Guard behavior. Ordinary app policy still decides whether
            // WhatsApp is approved/visible at all.
            releaseLegacyGuardSuspension(context, dpm, admin)
            return "DISABLED"
        }

        if (!accessibilityEnabled(context)) {
            // Optional guard requested, but setup is not complete yet. Keep
            // WhatsApp usable and report the pending state instead of greying/
            // suspending the whole app.
            releaseLegacyGuardSuspension(context, dpm, admin)
            return "WAITING_FOR_ACCESSIBILITY"
        }

        // PolicyEnforcer normally releases approved apps. Releasing here too
        // closes the setup transition immediately when Accessibility connects.
        releaseLegacyGuardSuspension(context, dpm, admin)
        return "PROTECTED"
    }
}
