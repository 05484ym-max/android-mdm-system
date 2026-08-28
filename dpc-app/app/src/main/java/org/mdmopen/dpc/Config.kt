package org.mdmopen.dpc

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

object Config {
    private const val PREFS = "dpc_config"
    private const val KEY_SERVER_URL = "server_url"
    private const val DEFAULT_SERVER_URL = "https://android-mdm-system.onrender.com"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_ALLOWED_APPS = "allowed_apps"
    private const val KEY_APP_CATALOG = "app_catalog"
    private const val KEY_KIOSK = "kiosk_enabled"
    private const val KEY_SYNC_MINUTES = "sync_interval_minutes"
    private const val KEY_ADMIN_PIN = "admin_pin_sha256"
    private const val KEY_PENDING_ENROLL = "pending_enrollment_token"
    private const val KEY_PUSH_TOKEN = "push_token"
    private const val KEY_LAST_SYNC_AT = "last_sync_at"
    private const val KEY_PLAY_STORE_ALLOWED_UNTIL = "play_store_allowed_until"

    const val DEFAULT_SYNC_MINUTES = 60

    fun serverUrl(context: Context): String =
        prefs(context).getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL

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

    /** Display metadata (name, icon) for the customer's approved apps, so the
     * in-app store can show a real catalog instead of raw package names. */
    fun appCatalog(context: Context): List<CatalogApp> {
        val raw = prefs(context).getString(KEY_APP_CATALOG, null) ?: return emptyList()
        val array = JSONArray(raw)
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            CatalogApp(
                packageName = item.getString("packageName"),
                name = item.getString("name"),
                iconUrl = if (item.isNull("iconUrl")) null else item.optString("iconUrl", null),
            )
        }
    }

    fun setAppCatalog(context: Context, catalog: List<CatalogApp>) {
        val array = JSONArray()
        catalog.forEach { app ->
            array.put(
                JSONObject()
                    .put("packageName", app.packageName)
                    .put("name", app.name)
                    .put("iconUrl", app.iconUrl)
            )
        }
        prefs(context).edit().putString(KEY_APP_CATALOG, array.toString()).apply()
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

    /** Epoch millis of the last successful sync, for the "last updated" label. */
    fun lastSyncAt(context: Context): Long =
        prefs(context).getLong(KEY_LAST_SYNC_AT, 0L)

    fun setLastSyncNow(context: Context) {
        prefs(context).edit().putLong(KEY_LAST_SYNC_AT, System.currentTimeMillis()).apply()
    }

    /** Epoch millis until which the store-guard service lets Play Store stay open. */
    fun playStoreAllowedUntil(context: Context): Long =
        prefs(context).getLong(KEY_PLAY_STORE_ALLOWED_UNTIL, 0L)

    fun setPlayStoreAllowedUntil(context: Context, until: Long) {
        prefs(context).edit().putLong(KEY_PLAY_STORE_ALLOWED_UNTIL, until).apply()
    }

    /** Enrolment code handed over by the QR code, consumed once at provisioning. */
    fun pendingEnrollmentToken(context: Context): String? =
        prefs(context).getString(KEY_PENDING_ENROLL, null)

    fun setPendingEnrollmentToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_PENDING_ENROLL, token).apply()
    }

    fun clearPendingEnrollmentToken(context: Context) {
        prefs(context).edit().remove(KEY_PENDING_ENROLL).apply()
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
