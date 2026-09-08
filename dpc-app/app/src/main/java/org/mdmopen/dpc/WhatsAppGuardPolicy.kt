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

/**
 * Device-Owner enforcement around the optional accessibility based WhatsApp guard.
 *
 * Android does not provide a supported Device Owner API that silently enables
 * an AccessibilityService, so the first enable remains a one-time local action.
 * Before that first successful setup WhatsApp stays usable. Once the guard has
 * successfully reached PROTECTED at least once, loss of Accessibility is treated
 * as tampering/failure and WhatsApp fails closed until the service returns.
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

    /** Called after the ordinary app policy was applied. */
    fun reconcile(context: Context, policy: WhatsAppGuardPolicy): String {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return "NOT_DEVICE_OWNER"

        if (!policy.enabled) {
            // Admin intentionally disabled the optional guard. Ordinary app
            // policy still decides whether WhatsApp itself is approved.
            setGuardSuspended(context, dpm, admin, false)
            return "DISABLED"
        }

        if (!accessibilityEnabled(context)) {
            return if (WhatsAppGuardConfig.wasProtected(context)) {
                // The device previously completed setup. Losing Accessibility
                // now means the content filter cannot be guaranteed, so fail closed.
                setGuardSuspended(context, dpm, admin, true)
                "ACCESSIBILITY_LOST_BLOCKED"
            } else {
                // First-time setup only: keep WhatsApp usable while the local
                // one-time Accessibility enable step is still pending.
                setGuardSuspended(context, dpm, admin, false)
                "WAITING_FOR_ACCESSIBILITY"
            }
        }

        WhatsAppGuardConfig.markProtected(context)
        setGuardSuspended(context, dpm, admin, false)
        return "PROTECTED"
    }
}
