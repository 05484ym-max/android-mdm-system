package org.mdmopen.filteredbrowser

import java.net.IDN
import java.net.URI
import java.net.URL
import java.util.Locale

enum class NavigationDecision { ALLOW, BLOCK }

data class PolicyRule(val host: String, val allowSubdomains: Boolean = false)

data class NavigationResult(
    val decision: NavigationDecision,
    val normalizedHost: String? = null,
    val reason: String,
)

class NavigationPolicy(rules: Collection<PolicyRule>) {
    private val rules = rules.mapNotNull { rule ->
        normalizeHost(rule.host)?.let { rule.copy(host = it) }
    }

    fun evaluate(rawUrl: String?): NavigationResult {
        if (rawUrl.isNullOrBlank()) return blocked("empty_url")
        if (rawUrl.length > MAX_URL_LENGTH) return blocked("url_too_long")
        if ('\\' in rawUrl) return blocked("backslash_rejected")

        val uri = try { URI(rawUrl) } catch (_: Exception) { return blocked("malformed_url") }
        val scheme = uri.scheme?.lowercase(Locale.US) ?: return blocked("missing_scheme")
        if (scheme != "https") return blocked("forbidden_scheme")
        if (uri.userInfo != null) return blocked("userinfo_rejected")

        val parsedHost = uri.host ?: try { URL(rawUrl).host } catch (_: Exception) { null }
        val host = normalizeHost(parsedHost) ?: return blocked("invalid_host")
        if (isIpLiteral(host)) return blocked("ip_literal_rejected", host)

        val matchingRule = rules.firstOrNull { rule ->
            host == rule.host ||
                (rule.allowSubdomains && host.endsWith("." + rule.host) && host.length > rule.host.length + 1)
        }

        return if (matchingRule != null) {
            NavigationResult(NavigationDecision.ALLOW, host, "local_policy")
        } else {
            blocked("unknown_host", host)
        }
    }

    private fun blocked(reason: String, host: String? = null) =
        NavigationResult(NavigationDecision.BLOCK, host, reason)

    companion object {
        private const val MAX_URL_LENGTH = 8192
        private val HOST_RE =
            Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")

        fun normalizeHost(rawHost: String?): String? {
            val input = rawHost?.trim()?.trimEnd('.')?.lowercase(Locale.US) ?: return null
            if (input.isBlank() || input.length > 253) return null
            val ascii = try {
                IDN.toASCII(input, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.US)
            } catch (_: Exception) {
                return null
            }
            if (ascii.length > 253 || !HOST_RE.matches(ascii)) return null
            return ascii
        }

        private fun isIpLiteral(host: String): Boolean {
            if (host.contains(':')) return true
            val parts = host.split('.')
            if (parts.size != 4) return false
            return parts.all { part ->
                part.isNotEmpty() && part.all(Char::isDigit) &&
                    part.toIntOrNull()?.let { it in 0..255 } == true
            }
        }
    }
}
