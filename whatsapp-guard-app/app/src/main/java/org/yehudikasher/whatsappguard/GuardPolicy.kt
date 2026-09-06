package org.yehudikasher.whatsappguard

import android.content.Context

data class GuardPolicy(
    val blockStatuses: Boolean,
    val blockChannels: Boolean,
    val hideProfilePhotos: Boolean,
) {
    companion object {
        private const val PREFS = "whatsapp_guard_policy"
        private const val KEY_STATUS = "block_statuses"
        private const val KEY_CHANNELS = "block_channels"
        private const val KEY_PROFILE = "hide_profile_photos"

        fun load(context: Context): GuardPolicy {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return GuardPolicy(
                blockStatuses = prefs.getBoolean(KEY_STATUS, true),
                blockChannels = prefs.getBoolean(KEY_CHANNELS, true),
                hideProfilePhotos = prefs.getBoolean(KEY_PROFILE, true),
            )
        }

        fun save(context: Context, policy: GuardPolicy) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_STATUS, policy.blockStatuses)
                .putBoolean(KEY_CHANNELS, policy.blockChannels)
                .putBoolean(KEY_PROFILE, policy.hideProfilePhotos)
                .apply()
        }
    }
}
