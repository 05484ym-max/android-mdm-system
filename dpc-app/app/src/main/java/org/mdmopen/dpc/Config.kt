package org.mdmopen.dpc

import android.content.Context
import java.security.MessageDigest
import java.util.UUID

object Config {
    private const val PREFS = "dpc_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_ALLOWED_APPS = "allowed_apps"
    private const val KEY_KIOSK = "kiosk_enabled"
    private const val KEY_SYNC_MINUTES = "sync_interval_minutes"
    private const val KEY_ADMIN_PIN = "admin_pin_sha256"
    private const val KEY_PUSH_TOKEN = "push_token"

    const val DEFAULT_SYNC_MINUTES = 60

    fun serverUrl(context: Context): String =
        prefs(context).getString(KEY_SERVER_URL, "").orEmpty()

    fun setServerUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_SERVER_URL, url.trim().trimEnd('/')).apply()
    }

    /** Stable per-device identifier, generated once on first use. */
    fun deviceId(context: Context): String {
        val p = prefs(context)
        p.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        p.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    /** Long-lived token issued by the server at enrollment. */
    fun deviceToken(context: Context): String? =
        prefs(context).getString(KEY_DEVICE_TOKEN, null)

    fun setDeviceToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }

    /** Last policy pulled from the server, so the kiosk works offline too. */
    fun allowedApps(context: Context): List<String> =
        prefs(context).getStringSet(KEY_ALLOWED_APPS, emptySet()).orEmpty().sorted()

    fun setAllowedApps(context: Context, apps: List<String>) {
        prefs(context).edit().putStringSet(KEY_ALLOWED_APPS, apps.toSet()).apply()
    }

    fun kioskEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_KIOSK, false)

    fun setKioskEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_KIOSK, enabled).apply()
    }

    fun syncIntervalMinutes(context: Context): Int =
        prefs(context).getInt(KEY_SYNC_MINUTES, DEFAULT_SYNC_MINUTES)

    fun setSyncIntervalMinutes(context: Context, minutes: Int) {
        prefs(context).edit().putInt(KEY_SYNC_MINUTES, minutes).apply()
    }

    /** The last FCM token we successfully handed to the server. */
    fun pushToken(context: Context): String? =
        prefs(context).getString(KEY_PUSH_TOKEN, null)

    fun setPushToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_PUSH_TOKEN, token).apply()
    }

    fun hasAdminPin(context: Context): Boolean =
        prefs(context).getString(KEY_ADMIN_PIN, null) != null

    fun setAdminPin(context: Context, pin: String) {
        prefs(context).edit().putString(KEY_ADMIN_PIN, sha256(pin)).apply()
    }

    fun checkAdminPin(context: Context, pin: String): Boolean =
        prefs(context).getString(KEY_ADMIN_PIN, null) == sha256(pin)

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
