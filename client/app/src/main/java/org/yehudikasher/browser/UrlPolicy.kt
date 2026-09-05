package org.yehudikasher.browser

import java.net.IDN
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

enum class LocalDecision {
    ALLOW,
    BLOCK
}

data class LocalPolicyRule(
    val host: String,
    val allowSubdomains: Boolean = false
)

data class UrlDecision(
    val decision: LocalDecision,
    val normalizedHost: String? = null,
    val reason: String
)

class UrlPolicy(rules: Collection<LocalPolicyRule>) {
    private val dynamicAllowedHosts = ConcurrentHashMap.newKeySet<String>()

    private val normalizedRules = rules.mapNotNull { rule ->
        normalizeHost(rule.host)?.let { normalized ->
            rule.copy(host = normalized)
        }
    }

    private val dangerousSchemes = setOf(
        "intent", "file", "data", "javascript", "content", "blob"
    )

    fun evaluate(rawUrl: String?): UrlDecision {
        if (rawUrl.isNullOrBlank()) {
            return blocked("empty_url")
        }
        if (rawUrl.length > MAX_URL_LENGTH) {
            return blocked("url_too_long")
        }
        if (rawUrl != rawUrl.trim()) {
            return blocked("surrounding_whitespace_rejected")
        }
        if ('\\' in rawUrl) {
            return blocked("backslash_rejected")
        }

        if (rawUrl.equals("about:blank", ignoreCase = true)) {
            return UrlDecision(LocalDecision.ALLOW, reason = "internal_blank")
        }

        val uri = try {
            URI(rawUrl)
        } catch (_: Exception) {
            return blocked("malformed_url")
        }

        val scheme = uri.scheme?.lowercase(Locale.US)
            ?: return blocked("missing_scheme")

        if (scheme in dangerousSchemes) {
            return blocked("dangerous_scheme")
        }
        if (scheme != "https") {
            return blocked("https_required")
        }
        if (uri.userInfo != null) {
            return blocked("userinfo_not_allowed")
        }
        if (uri.port != -1 && uri.port != 443) {
            return blocked("non_default_https_port")
        }

        val host = normalizeHost(uri.host)
            ?: return blocked("invalid_host")

        if (isIpLiteral(host)) {
            return blocked("ip_literal_rejected", host)
        }

        // Very narrow local fast-path for the browser-generated search URL.
        // We deliberately do NOT trust the whole DuckDuckGo host: the exact
        // root path and every strict-search parameter must match. This means a
        // user cannot switch Safe Search off by editing the URL, and unrelated
        // DuckDuckGo pages still go through normal remote classification.
        if (isExactStrictSearchUrl(uri, host)) {
            return UrlDecision(
                LocalDecision.ALLOW,
                normalizedHost = host,
                reason = "strict_search_allow"
            )
        }

        val matchingRule = normalizedRules.firstOrNull { rule ->
            host == rule.host ||
                (rule.allowSubdomains &&
                    host.length > rule.host.length + 1 &&
                    host.endsWith("." + rule.host))
        }
        val dynamicallyAllowed = host in dynamicAllowedHosts

        return if (matchingRule != null || dynamicallyAllowed) {
            UrlDecision(
                LocalDecision.ALLOW,
                normalizedHost = host,
                reason = when {
                    dynamicallyAllowed -> "remote_allow"
                    host == matchingRule?.host -> "exact_allow"
                    else -> "subdomain_allow"
                }
            )
        } else {
            blocked("not_in_local_policy", host)
        }
    }

    fun rememberRemoteAllow(rawHost: String): Boolean {
        val host = normalizeHost(rawHost) ?: return false
        if (isIpLiteral(host)) return false
        dynamicAllowedHosts.add(host)
        return true
    }

    fun forgetRemoteAllow(rawHost: String) {
        normalizeHost(rawHost)?.let { dynamicAllowedHosts.remove(it) }
    }

    private fun isExactStrictSearchUrl(uri: URI, host: String): Boolean {
        if (host != STRICT_SEARCH_HOST) return false
        if (uri.rawFragment != null) return false
        if (uri.path != "/") return false

        val rawQuery = uri.rawQuery ?: return false
        val params = LinkedHashMap<String, MutableList<String>>()

        for (part in rawQuery.split('&')) {
            if (part.isEmpty()) return false
            val pieces = part.split('=', limit = 2)
            if (pieces.size != 2) return false

            val key = decodeQueryComponent(pieces[0]) ?: return false
            val value = decodeQueryComponent(pieces[1]) ?: return false
            if (key !in STRICT_SEARCH_KEYS) return false
            params.getOrPut(key) { mutableListOf() }.add(value)
        }

        // Reject duplicate parameters as well as missing/extra parameters.
        if (params.keys != STRICT_SEARCH_KEYS) return false
        if (params.values.any { it.size != 1 }) return false

        val query = params["q"]?.singleOrNull()?.trim().orEmpty()
        if (query.isEmpty()) return false

        return params["kp"]?.singleOrNull() == "1" &&
            params["kl"]?.singleOrNull() == "il-he" &&
            params["kc"]?.singleOrNull() == "-1" &&
            params["kac"]?.singleOrNull() == "-1"
    }

    private fun decodeQueryComponent(raw: String): String? = try {
        URLDecoder.decode(raw, StandardCharsets.UTF_8.name())
    } catch (_: Exception) {
        null
    }

    private fun blocked(reason: String, host: String? = null) =
        UrlDecision(LocalDecision.BLOCK, normalizedHost = host, reason = reason)

    companion object {
        private const val MAX_URL_LENGTH = 8192
        private const val STRICT_SEARCH_HOST = "duckduckgo.com"
        private val STRICT_SEARCH_KEYS = linkedSetOf("kp", "kl", "kc", "kac", "q")

        private val HOST_RE = Regex(
            "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
        )

        fun normalizeHost(raw: String?): String? {
            val input = raw?.trim()?.trimEnd('.')?.lowercase(Locale.US)
                ?: return null
            if (input.isBlank() || input.length > 253) return null

            val ascii = try {
                IDN.toASCII(input, IDN.USE_STD3_ASCII_RULES)
                    .lowercase(Locale.US)
            } catch (_: Exception) {
                return null
            }

            if (ascii.length > 253 || !HOST_RE.matches(ascii)) {
                return null
            }
            return ascii
        }

        private fun isIpLiteral(host: String): Boolean {
            if (host.contains(':')) return true

            val parts = host.split('.')
            if (parts.size != 4) return false

            return parts.all { part ->
                part.isNotEmpty() &&
                    part.all(Char::isDigit) &&
                    part.toIntOrNull()?.let { it in 0..255 } == true
            }
        }
    }
}
