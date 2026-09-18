package org.yehudikasher.browser

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.util.LinkedHashMap

data class RemotePolicyDecision(
    val allowed: Boolean,
    val reason: String,
    val expiresAtMs: Long? = null,
)

class RemotePolicyClient(
    private val context: Context,
    private val fallbackBaseUrl: String = BuildConfig.FILTER_API_BASE_URL,
) {
    private data class Cached(
        val decision: RemotePolicyDecision,
        val expiresAtMs: Long,
    )

    private val cacheLock = Any()
    private val cache = object : LinkedHashMap<String, Cached>(MAX_MEMORY_ENTRIES, 0.75f, true) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, Cached>?
        ): Boolean = size > MAX_MEMORY_ENTRIES
    }

    fun checkHost(rawHost: String): RemotePolicyDecision {
        val host = UrlPolicy.normalizeHost(rawHost)
            ?: return RemotePolicyDecision(false, "invalid_host")

        val now = System.currentTimeMillis()
        synchronized(cacheLock) {
            cache[host]?.let { cached ->
                if (cached.expiresAtMs > now) {
                    BrowserPerf.record("host_policy", "memory_cache", 0)
                    return cached.decision
                }
                cache.remove(host)
            }
        }

        val started = android.os.SystemClock.elapsedRealtime()
        val decision = fetchDecision(host)
        BrowserPerf.record(
            "host_policy",
            if (decision.first.allowed) "network_allow" else "network_non_allow",
            android.os.SystemClock.elapsedRealtime() - started,
        )
        // The server normally supplies expiresAt from its shared PostgreSQL
        // cache. For transient errors that don't carry it, keep only a short
        // local cache so a temporary outage is fail-closed without becoming a
        // permanent local block.
        val expiresAt = decision.second ?: (now + TRANSIENT_CACHE_MS)
        val expiringDecision = decision.first.copy(expiresAtMs = expiresAt)
        synchronized(cacheLock) {
            cache[host] = Cached(expiringDecision, expiresAt)
        }
        return expiringDecision
    }

    private fun fetchDecision(host: String): Pair<RemotePolicyDecision, Long?> {
        val encoded = URLEncoder.encode(host, "UTF-8").replace("+", "%20")
        val deviceConfig = BrowserDeviceConfigStore.load(context.applicationContext)
        val baseUrl = deviceConfig?.serverUrl ?: fallbackBaseUrl
        val deviceQuery = deviceConfig?.let {
            "&deviceId=" + URLEncoder.encode(it.deviceId, "UTF-8").replace("+", "%20")
        }.orEmpty()
        val conn = (URL(baseUrl.trimEnd('/') + "/api/browser/check?host=" + encoded + deviceQuery)
            .openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "YehudiKasherFilteredBrowser/1")
            deviceConfig?.browserToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            instanceFollowRedirects = false
        }

        return try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()

            val json = try {
                JSONObject(text)
            } catch (_: Exception) {
                null
            }

            val allowed = code in 200..299 && json?.optBoolean("allowed", false) == true
            val reason = json?.optString("reason")
                ?.takeIf { it.isNotBlank() }
                ?: if (code == 429) "rate_limited" else "classifier_http_$code"

            val expiresAt = json?.optString("expiresAt")
                ?.takeIf { it.isNotBlank() }
                ?.let {
                    try {
                        Instant.parse(it).toEpochMilli()
                    } catch (_: Exception) {
                        null
                    }
                }

            RemotePolicyDecision(allowed, reason) to expiresAt
        } catch (_: Exception) {
            RemotePolicyDecision(false, "classifier_unreachable") to null
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val TRANSIENT_CACHE_MS = 5 * 60 * 1000L
        private const val MAX_MEMORY_ENTRIES = 256
    }
}
