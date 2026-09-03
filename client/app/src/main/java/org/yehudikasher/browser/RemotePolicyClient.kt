package org.yehudikasher.browser

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

data class RemotePolicyDecision(
    val allowed: Boolean,
    val reason: String,
)

class RemotePolicyClient(
    private val baseUrl: String = BuildConfig.FILTER_API_BASE_URL,
) {
    private data class Cached(
        val decision: RemotePolicyDecision,
        val expiresAtMs: Long,
    )

    private val cache = ConcurrentHashMap<String, Cached>()

    fun checkHost(rawHost: String): RemotePolicyDecision {
        val host = UrlPolicy.normalizeHost(rawHost)
            ?: return RemotePolicyDecision(false, "invalid_host")

        val now = System.currentTimeMillis()
        cache[host]?.let { cached ->
            if (cached.expiresAtMs > now) return cached.decision
            cache.remove(host, cached)
        }

        val decision = fetchDecision(host)
        // The server normally supplies expiresAt from its shared PostgreSQL
        // cache. For transient errors that don't carry it, keep only a short
        // local cache so a temporary outage is fail-closed without becoming a
        // permanent local block.
        val expiresAt = decision.second ?: (now + TRANSIENT_CACHE_MS)
        cache[host] = Cached(decision.first, expiresAt)
        return decision.first
    }

    private fun fetchDecision(host: String): Pair<RemotePolicyDecision, Long?> {
        val encoded = URLEncoder.encode(host, "UTF-8").replace("+", "%20")
        val conn = (URL(baseUrl.trimEnd('/') + "/api/browser/check?host=" + encoded)
            .openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "YehudiKasherFilteredBrowser/1")
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
    }
}
