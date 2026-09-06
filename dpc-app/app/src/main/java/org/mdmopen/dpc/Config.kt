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
    private const val KEY_DNS_PROVIDER_HOST = "dns_provider_host"
    private const val KEY_DNS_FILTERING_REQUESTED = "dns_filtering_requested"
    private const val KEY_DNS_ALLOW_CUSTOMER_TOGGLE = "dns_allow_customer_toggle"
    private const val KEY_DNS_PROVIDER_FILTERS = "dns_provider_filters"
    private const val KEY_DNS_PENDING_CUSTOMER_REQUEST = "dns_pending_customer_request"
    private const val KEY_NEWS_CACHE = "news_cache"
    private const val KEY_READ_UPDATE_IDS = "read_update_ids"
    private const val KEY_STORE_ACCESS_ALLOWED = "store_access_allowed"
    private const val KEY_SUBSCRIPTION_EXPIRY_DATE = "subscription_expiry_date"

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
                playVersion = if (item.isNull("playVersion")) null else item.optString("playVersion", null),
                playUpdatedAt = if (item.isNull("playUpdatedAt")) null else item.optLong("playUpdatedAt"),
                category = item.optString("category", "other").ifBlank { "other" },
                categoryLabel = item.optString("categoryLabel", "אחר").ifBlank { "אחר" },
                isRecommended = item.optBoolean("isRecommended", false),
                sortOrder = item.optInt("sortOrder", 0).coerceIn(0, 100000),
                appSource = item.optString("appSource", "PLAY").ifBlank { "PLAY" },
                apkUrl = if (item.isNull("apkUrl")) null else item.optString("apkUrl", null),
                apkSha256 = if (item.isNull("apkSha256")) null else item.optString("apkSha256", null),
                apkSizeBytes = if (item.isNull("apkSizeBytes")) null else item.optLong("apkSizeBytes"),
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
                    .put("playVersion", app.playVersion)
                    .put("playUpdatedAt", app.playUpdatedAt)
                    .put("category", app.category)
                    .put("categoryLabel", app.categoryLabel)
                    .put("isRecommended", app.isRecommended)
                    .put("sortOrder", app.sortOrder)
                    .put("appSource", app.appSource)
                    .put("apkUrl", app.apkUrl)
                    .put("apkSha256", app.apkSha256)
                    .put("apkSizeBytes", app.apkSizeBytes)
            )
        }
        prefs(context).edit().putString(KEY_APP_CATALOG, array.toString()).apply()
    }

    /** Last fetch of "חדשות ועדכונים" (see ApiClient.fetchUpdates), cached so
     * the tab has something real to show immediately (and the unread badge
     * can be computed) before a fresh network round trip completes - same
     * "last known good, not a hard requirement of being online" idea as
     * appCatalog above. Never the source of truth for what's actually
     * published; a background refresh always follows. */
    fun newsCache(context: Context): List<UpdateItem> {
        val raw = prefs(context).getString(KEY_NEWS_CACHE, null) ?: return emptyList()
        val array = JSONArray(raw)
        return (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            UpdateItem(
                id = item.getString("id"),
                title = item.getString("title"),
                body = item.getString("body"),
                pinned = item.optBoolean("pinned", false),
                publishedAt = item.getString("publishedAt"),
                mediaType = if (item.isNull("mediaType")) null else item.optString("mediaType", null),
                mediaUrl = if (item.isNull("mediaUrl")) null else item.optString("mediaUrl", null),
                mediaMimeType = if (item.isNull("mediaMimeType")) null else item.optString("mediaMimeType", null),
                mediaSizeBytes = if (item.isNull("mediaSizeBytes")) null else item.optLong("mediaSizeBytes"),
            )
        }
    }

    fun setNewsCache(context: Context, items: List<UpdateItem>) {
        val array = JSONArray()
        items.forEach { item ->
            array.put(
                JSONObject()
                    .put("id", item.id)
                    .put("title", item.title)
                    .put("body", item.body)
                    .put("pinned", item.pinned)
                    .put("publishedAt", item.publishedAt)
                    .put("mediaType", item.mediaType)
                    .put("mediaUrl", item.mediaUrl)
                    .put("mediaMimeType", item.mediaMimeType)
                    .put("mediaSizeBytes", item.mediaSizeBytes)
            )
        }
        prefs(context).edit().putString(KEY_NEWS_CACHE, array.toString()).apply()
    }

    /**
     * Read-state for "חדשות ועדכונים" - tracked entirely on this device,
     * per the task's own instruction that no per-customer read-state needs
     * to exist server-side yet. A Set<String> of update ids the customer
     * has actually opened (see CustomerActivity.showNewsDetail) - an id
     * that never arrived from the server (deleted, or from a future
     * reinstall) simply never matches anything and costs nothing to keep.
     */
    fun readUpdateIds(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_READ_UPDATE_IDS, emptySet()).orEmpty()

    fun isUpdateRead(context: Context, id: String): Boolean =
        id in readUpdateIds(context)

    fun markUpdateRead(context: Context, id: String) {
        val current = readUpdateIds(context)
        if (id in current) return
        // getStringSet's returned Set must be treated as immutable (its own
        // docs warn against mutating it in place) - copy before adding.
        prefs(context).edit().putStringSet(KEY_READ_UPDATE_IDS, current + id).apply()
    }

    /** Server-authoritative entitlement for the in-app app store only.
     * Defaults open until the first new-server sync so an app-first rollout
     * cannot accidentally lock paying customers. It never controls the rest
     * of the device, already-installed apps, filtering, or Device Owner. */
    fun storeAccessAllowed(context: Context): Boolean =
        prefs(context).getBoolean(KEY_STORE_ACCESS_ALLOWED, true)

    fun subscriptionExpiryDate(context: Context): String? =
        prefs(context).getString(KEY_SUBSCRIPTION_EXPIRY_DATE, null)

    fun setSubscriptionAccess(context: Context, access: SubscriptionAccess) {
        prefs(context).edit()
            .putBoolean(KEY_STORE_ACCESS_ALLOWED, access.allowed)
            .putString(KEY_SUBSCRIPTION_EXPIRY_DATE, access.subscriptionExpiryDate)
            .apply()
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

    /**
     * Server-authoritative DNS policy, delivered every sync (see PolicySync /
     * ApiClient's SyncResult.dns) - the device never hardcodes a provider
     * host or decides on its own whether filtering should be on.
     * dnsDesiredProviderHost is deliberately separate from
     * AdBlockDns.currentActualProviderHost() (a live read of what's really
     * configured on the device right now) - conflating the two into one
     * field previously meant a device's own status report could overwrite
     * what an admin had just asked for, before the device even applied it.
     */
    fun dnsDesiredProviderHost(context: Context): String? =
        prefs(context).getString(KEY_DNS_PROVIDER_HOST, null)

    fun dnsFilteringRequested(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DNS_FILTERING_REQUESTED, false)

    /** Whether the customer's own in-app switch is allowed to change DNS
     * filtering - server-controlled per device. Defaults to false (read-only)
     * so a device that hasn't synced this yet can't be toggled by the customer. */
    fun dnsAllowCustomerToggle(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DNS_ALLOW_CUSTOMER_TOGGLE, false)

    /** Whether the currently configured provider actually filters content
     * (ads/adult content/etc.) rather than being a plain encrypted resolver
     * with no filtering of its own - server-controlled, since only the
     * server/ops know which real provider is behind dnsDesiredProviderHost
     * today. Defaults to false: never claim filtering is happening unless
     * the server has explicitly said so. */
    fun dnsDesiredProviderFilters(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DNS_PROVIDER_FILTERS, false)

    fun setDnsPolicy(
        context: Context,
        providerHost: String?,
        filteringRequested: Boolean,
        allowCustomerToggle: Boolean,
        providerFilters: Boolean,
    ) {
        prefs(context).edit()
            .putString(KEY_DNS_PROVIDER_HOST, providerHost)
            .putBoolean(KEY_DNS_FILTERING_REQUESTED, filteringRequested)
            .putBoolean(KEY_DNS_ALLOW_CUSTOMER_TOGGLE, allowCustomerToggle)
            .putBoolean(KEY_DNS_PROVIDER_FILTERS, providerFilters)
            .apply()
    }

    /**
     * A customer-initiated toggle not yet confirmed by the server - set the
     * instant the customer flips the switch, cleared only once a sync
     * response has actually processed it (see PolicySync.run() /
     * CustomerActivity's toggle handler). Survives an offline click: it
     * rides along on whichever sync succeeds next, scheduled or manual,
     * instead of being lost or retried by a separate ad-hoc mechanism.
     */
    fun dnsPendingCustomerRequest(context: Context): Boolean? =
        if (prefs(context).contains(KEY_DNS_PENDING_CUSTOMER_REQUEST)) {
            prefs(context).getBoolean(KEY_DNS_PENDING_CUSTOMER_REQUEST, false)
        } else {
            null
        }

    fun setDnsPendingCustomerRequest(context: Context, value: Boolean?) {
        val editor = prefs(context).edit()
        if (value == null) editor.remove(KEY_DNS_PENDING_CUSTOMER_REQUEST)
        else editor.putBoolean(KEY_DNS_PENDING_CUSTOMER_REQUEST, value)
        editor.apply()
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
