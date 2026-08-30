package org.mdmopen.dpc

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

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
    // Legacy key name/format kept as-is (unsalted single-round SHA-256 hex) purely
    // so an already-set PIN on an existing device keeps validating - see
    // checkAdminPin(). Any newly set or successfully-verified PIN is stored only
    // under KEY_ADMIN_PIN_V2 from here on.
    private const val KEY_ADMIN_PIN = "admin_pin_sha256"
    private const val KEY_ADMIN_PIN_V2 = "admin_pin_v2"
    private const val PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val PBKDF2_FORMAT_ID = "pbkdf2_sha256"
    private const val PBKDF2_ITERATIONS = 120_000
    // A stored iteration count outside this range is treated as corrupted/
    // tampered rather than trusted - see verifyPbkdf2(). Comfortably covers
    // PBKDF2_ITERATIONS today and room to raise it later without ever
    // computing an absurd (and slow) value.
    private const val PBKDF2_MIN_ITERATIONS = 10_000
    private const val PBKDF2_MAX_ITERATIONS = 1_000_000
    private const val PBKDF2_SALT_BYTES = 16
    private const val PBKDF2_KEY_BITS = 256
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

    /** Placeholder identifier used only before enrollment assigns the real one. */
    fun deviceId(context: Context): String {
        val p = prefs(context)
        p.getString(KEY_DEVICE_ID, null)?.let { return it }
        val id = UUID.randomUUID().toString()
        p.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    /** The short numeric ID the server assigns at enrollment - replaces the
     * placeholder above so the admin has something readable to type in. */
    fun setDeviceId(context: Context, id: String) {
        prefs(context).edit().putString(KEY_DEVICE_ID, id).apply()
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

    fun hasAdminPin(context: Context): Boolean {
        val p = prefs(context)
        return p.getString(KEY_ADMIN_PIN_V2, null) != null ||
            p.getString(KEY_ADMIN_PIN, null) != null
    }

    /** Always writes the current (PBKDF2) format only, and drops any legacy
     * SHA-256 value - a freshly set PIN supersedes it either way. */
    fun setAdminPin(context: Context, pin: String) {
        prefs(context).edit()
            .putString(KEY_ADMIN_PIN_V2, hashPinPbkdf2(pin))
            .remove(KEY_ADMIN_PIN)
            .apply()
    }

    /**
     * Verifies against the PBKDF2 hash when one exists. Otherwise falls back to
     * the legacy unsalted-SHA-256 value so a PIN set before this change keeps
     * working: a correct legacy PIN is transparently migrated to the PBKDF2
     * format (and the legacy value removed) in the same call, with no visible
     * difference to the caller: an incorrect legacy PIN changes nothing.
     */
    fun checkAdminPin(context: Context, pin: String): Boolean {
        val p = prefs(context)

        p.getString(KEY_ADMIN_PIN_V2, null)?.let { stored ->
            return verifyPbkdf2(pin, stored)
        }

        val legacy = p.getString(KEY_ADMIN_PIN, null) ?: return false
        if (!MessageDigest.isEqual(sha256Hex(pin).toByteArray(), legacy.toByteArray())) {
            return false
        }
        setAdminPin(context, pin)
        return true
    }

    private fun hashPinPbkdf2(pin: String): String {
        val salt = ByteArray(PBKDF2_SALT_BYTES).also { SecureRandom().nextBytes(it) }
        val hash = pbkdf2(pin, salt, PBKDF2_ITERATIONS)
        return listOf(
            PBKDF2_FORMAT_ID,
            PBKDF2_ITERATIONS.toString(),
            Base64.encodeToString(salt, Base64.NO_WRAP),
            Base64.encodeToString(hash, Base64.NO_WRAP),
        ).joinToString("$")
    }

    private fun verifyPbkdf2(pin: String, stored: String): Boolean {
        val parts = stored.split("$")
        if (parts.size != 4 || parts[0] != PBKDF2_FORMAT_ID) return false

        val iterations = parts[1].toIntOrNull() ?: return false
        // Never trust an arbitrary stored iteration count: a corrupted or
        // tampered value could otherwise make verification trivially weak
        // (too low) or hang the device computing it (too high, e.g. a
        // garbled value read as billions). The bounds comfortably cover our
        // own format (120,000 today, room to raise it later) while rejecting
        // anything implausible.
        if (iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
            return false
        }

        val salt = try {
            Base64.decode(parts[2], Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            return false
        }
        if (salt.size != PBKDF2_SALT_BYTES) return false

        val expected = try {
            Base64.decode(parts[3], Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            return false
        }
        if (expected.size != PBKDF2_KEY_BITS / 8) return false

        val actual = try {
            pbkdf2(pin, salt, iterations)
        } catch (e: Exception) {
            return false
        }
        return MessageDigest.isEqual(actual, expected)
    }

    private fun pbkdf2(pin: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, iterations, PBKDF2_KEY_BITS)
        try {
            val factory = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM)
            return factory.generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
