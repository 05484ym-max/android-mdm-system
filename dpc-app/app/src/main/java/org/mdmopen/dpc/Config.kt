package org.mdmopen.dpc

import android.content.Context
import java.util.UUID

object Config {
    private const val PREFS = "dpc_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_ID = "device_id"

    fun serverUrl(context: Context): String =
        prefs(context).getString(KEY_SERVER_URL, "").orEmpty()

    fun setServerUrl(context: Context, url: String) {
        prefs(context).edit()
            .putString(KEY_SERVER_URL, url.trim().trimEnd('/'))
            .apply()
    }

    /** Stable per-device identifier, generated once on first use. */
    fun deviceId(context: Context): String {
        val p = prefs(context)
        p.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        p.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
