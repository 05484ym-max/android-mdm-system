package org.mdmopen.dpc

import android.content.Context

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
