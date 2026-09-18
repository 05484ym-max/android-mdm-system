package org.yehudikasher.browser

import android.content.Context

data class BrowserDeviceConfig(
    val serverUrl: String,
    val deviceId: String,
    val browserToken: String,
    val browserMode: String,
)

object BrowserDeviceConfigStore {
    private const val PREFS = "browser_device_config"
    private const val KEY_SERVER = "server"
    private const val KEY_DEVICE = "device"
    private const val KEY_TOKEN = "token"
    private const val KEY_MODE = "mode"

    fun save(context: Context, config: BrowserDeviceConfig) {
        if (config.serverUrl.isBlank() || config.deviceId.isBlank() || config.browserToken.isBlank()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_SERVER, config.serverUrl.trimEnd('/'))
            .putString(KEY_DEVICE, config.deviceId)
            .putString(KEY_TOKEN, config.browserToken)
            .putString(KEY_MODE, if (config.browserMode == "BLACKLIST") "BLACKLIST" else "WHITELIST")
            .apply()
    }

    fun load(context: Context): BrowserDeviceConfig? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val server = p.getString(KEY_SERVER, null)?.takeIf { it.startsWith("https://") } ?: return null
        val device = p.getString(KEY_DEVICE, null)?.takeIf { it.isNotBlank() } ?: return null
        val token = p.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() } ?: return null
        val mode = if (p.getString(KEY_MODE, "WHITELIST") == "BLACKLIST") "BLACKLIST" else "WHITELIST"
        return BrowserDeviceConfig(server, device, token, mode)
    }
}
