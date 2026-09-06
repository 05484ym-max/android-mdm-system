package org.mdmopen.dpc

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class Policy(
    val allowedApps: List<String>,
    val kioskEnabled: Boolean,
    val syncIntervalMinutes: Int,
)

/** Server-authoritative DNS policy - see Config.setDnsPolicy(). desiredProviderHost
 * is null until an admin has ever configured one; filteringRequested/
 * allowCustomerToggle/desiredProviderFilters all default closed (false) for a
 * device that hasn't been given a DNS policy yet. desiredProviderFilters
 * being false is not just "unknown" - it's the server explicitly saying the
 * configured provider doesn't actually filter content, so nothing here
 * should ever be labeled as ad/content blocking while it's false. */
data class DnsPolicy(
    val desiredProviderHost: String?,
    val filteringRequested: Boolean,
    val allowCustomerToggle: Boolean,
    val desiredProviderFilters: Boolean,
)

data class QueuedCommand(
    val id: String,
    val command: String,
    val params: JSONObject,
)

data class CatalogApp(
    val packageName: String,
    val name: String,
    val iconUrl: String?,
    val playVersion: String? = null,
    val playUpdatedAt: Long? = null,
    val category: String = "other",
    val categoryLabel: String = "אחר",
    val isRecommended: Boolean = false,
    val sortOrder: Int = 0,
    val appSource: String = "PLAY",
    val apkUrl: String? = null,
    val apkSha256: String? = null,
    val apkSizeBytes: Long? = null,
)

data class SubscriptionAccess(
    val allowed: Boolean,
    val subscriptionActive: Boolean,
    val overrideActive: Boolean,
    val overridePermanent: Boolean,
    val overrideUntil: String?,
    val subscriptionExpiryDate: String?,
)

data class SyncResult(
    val policy: Policy,
    val catalog: List<CatalogApp>,
    val commands: List<QueuedCommand>,
    val dns: DnsPolicy,
    val subscriptionAccess: SubscriptionAccess,
)

data class EnrollResult(val deviceId: String, val deviceToken: String)

/** One "חדשות ועדכונים" item. publishedAt is an ISO-8601 string (unlike
 * every epoch-millis timestamp elsewhere in this file) because it comes
 * straight from the server's Postgres TIMESTAMPTZ via toISOString() - see
 * backend/db.js's listPublishedCustomerUpdatesForDevice. */
data class UpdateItem(
    val id: String,
    val title: String,
    val body: String,
    val pinned: Boolean,
    val publishedAt: String,
    val mediaType: String? = null,
    val mediaUrl: String? = null,
    val mediaMimeType: String? = null,
    val mediaSizeBytes: Long? = null,
)

data class SupportTicket(
    val id: String,
    val subject: String,
    val message: String,
    val status: String,
    val adminReply: String?,
    val createdAt: String,
    val updatedAt: String,
)

class ApiException(message: String) : Exception(message)

class ApiClient(
    private val baseUrl: String,
    private val deviceToken: String? = null,
) {

    /** One-time enrollment. The server assigns the device its short numeric ID. */
    fun enroll(enrollmentToken: String): EnrollResult {
        val body = request(
            "POST",
            "/api/devices/register",
            JSONObject().put("enrollmentToken", enrollmentToken),
        )
        val json = JSONObject(body)
        return EnrollResult(json.getString("deviceId"), json.getString("deviceToken"))
    }

    /**
     * A whole sync cycle in one round trip: reports status, returns the policy and
     * any queued commands. The server marks those commands delivered.
     */
    fun sync(deviceId: String, status: JSONObject): SyncResult {
        val body = request("POST", "/api/devices/${segment(deviceId)}/sync", status)
        val json = JSONObject(body)

        val policyJson = json.getJSONObject("policy")
        val apps = policyJson.optJSONArray("allowedApps") ?: JSONArray()
        val policy = Policy(
            allowedApps = (0 until apps.length()).map { apps.getString(it) },
            kioskEnabled = policyJson.optBoolean("kioskEnabled", false),
            syncIntervalMinutes = policyJson.optInt(
                "syncIntervalMinutes",
                Config.DEFAULT_SYNC_MINUTES,
            ),
        )

        val queued = json.optJSONArray("commands") ?: JSONArray()
        val commands = (0 until queued.length()).map { index ->
            val item = queued.getJSONObject(index)
            QueuedCommand(
                    id = item.getString("id"),
                    command = item.getString("command"),
                params = item.optJSONObject("params") ?: JSONObject(),
            )
        }

        val catalogJson = json.optJSONArray("catalog") ?: JSONArray()
        val catalog = (0 until catalogJson.length()).map { index ->
            val item = catalogJson.getJSONObject(index)
            CatalogApp(
                packageName = item.getString("packageName"),
                name = item.optString("name", item.getString("packageName")),
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

        val dnsJson = json.optJSONObject("dns")
        val dns = DnsPolicy(
            desiredProviderHost = dnsJson?.let {
                if (it.isNull("desiredProviderHost")) null else it.optString("desiredProviderHost", null)
            },
            filteringRequested = dnsJson?.optBoolean("filteringRequested", false) ?: false,
            allowCustomerToggle = dnsJson?.optBoolean("allowCustomerToggle", false) ?: false,
            desiredProviderFilters = dnsJson?.optBoolean("desiredProviderFilters", false) ?: false,
        )

        val accessJson = json.optJSONObject("subscriptionAccess")
        val subscriptionAccess = SubscriptionAccess(
            // Backward-compatible fail-open for the store only: an older server
            // that does not send this field must not suddenly lock an existing
            // customer's store merely because the app updated first.
            allowed = accessJson?.optBoolean("allowed", true) ?: true,
            subscriptionActive = accessJson?.optBoolean("subscriptionActive", true) ?: true,
            overrideActive = accessJson?.optBoolean("overrideActive", false) ?: false,
            overridePermanent = accessJson?.optBoolean("overridePermanent", false) ?: false,
            overrideUntil = accessJson?.let { if (it.isNull("overrideUntil")) null else it.optString("overrideUntil", null) },
            subscriptionExpiryDate = accessJson?.let { if (it.isNull("subscriptionExpiryDate")) null else it.optString("subscriptionExpiryDate", null) },
        )

        return SyncResult(policy, catalog, commands, dns, subscriptionAccess)
    }

    fun reportCommandResult(
        deviceId: String,
        commandId: String,
        status: String,
        message: String?
    ) {
        request(
            "POST",
            "/api/devices/${segment(deviceId)}/commands/${segment(commandId)}/result",
            JSONObject()
                .put("status", status)
                .put("message", message ?: "")
        )
    }

    /** Lets the server push a wake-up to this device. */
    fun registerPushToken(deviceId: String, pushToken: String) {
        request(
            "POST",
            "/api/devices/${segment(deviceId)}/push-token",
            JSONObject().put("pushToken", pushToken),
        )
    }

    /** "חדשות ועדכונים" - a dedicated, lightweight GET, deliberately not
     * folded into sync()'s payload (see backend/index.js's comment on the
     * device-facing /updates route). Already published-only, pinned-first,
     * newest-first, capped server-side - nothing to filter/sort here. */
    fun fetchUpdates(deviceId: String): List<UpdateItem> {
        val body = request("GET", "/api/devices/${segment(deviceId)}/updates", null)
        val array = JSONArray(body)
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

    fun createSupportTicket(deviceId: String, subject: String, message: String): SupportTicket {
        val body = request(
            "POST",
            "/api/devices/${segment(deviceId)}/support-tickets",
            JSONObject().put("subject", subject).put("message", message),
        )
        return parseSupportTicket(JSONObject(body))
    }

    fun fetchSupportTickets(deviceId: String): List<SupportTicket> {
        val body = request("GET", "/api/devices/${segment(deviceId)}/support-tickets", null)
        val array = JSONArray(body)
        return (0 until array.length()).map { parseSupportTicket(array.getJSONObject(it)) }
    }

    private fun parseSupportTicket(item: JSONObject): SupportTicket = SupportTicket(
        id = item.getString("id"),
        subject = item.getString("subject"),
        message = item.getString("message"),
        status = item.optString("status", "OPEN"),
        adminReply = if (item.isNull("adminReply")) null else item.optString("adminReply", null),
        createdAt = item.getString("createdAt"),
        updatedAt = item.getString("updatedAt"),
    )

    private fun segment(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun request(method: String, path: String, body: JSONObject?): String {
        val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            // A sleeping free-tier instance can take close to a minute to wake up.
            connectTimeout = 20_000
            readTimeout = 90_000
            deviceToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8)
                    .use { it.write(body.toString()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use(BufferedReader::readText)
            }.orEmpty()
            if (code !in 200..299) {
                throw ApiException("HTTP $code: ${text.take(200)}")
            }
            return text
        } finally {
            conn.disconnect()
        }
    }
}
