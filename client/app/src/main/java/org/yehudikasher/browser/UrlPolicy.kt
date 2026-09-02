package org.yehudikasher.browser

import java.net.IDN
import java.net.URI
import java.util.Locale

enum class LocalDecision {
    ALLOW,
    BLOCK
}

data class UrlDecision(
    val decision: LocalDecision,
    val normalizedHost: String? = null,
    val reason: String
)

class UrlPolicy(
    private val exactAllowedHosts: Set<String>
) {
    private val dangerousSchemes = setOf(
        "intent", "file", "data", "javascript", "content", "blob"
    )

    fun evaluate(rawUrl: String?): UrlDecision {
        if (rawUrl.isNullOrBlank()) {
            return UrlDecision(LocalDecision.BLOCK, reason = "empty_url")
        }

        val trimmed = rawUrl.trim()

        if (trimmed.equals("about:blank", ignoreCase = true)) {
            return UrlDecision(LocalDecision.ALLOW, reason = "internal_blank")
        }

        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return UrlDecision(LocalDecision.BLOCK, reason = "malformed_url")
        }

        val scheme = uri.scheme?.lowercase(Locale.US)
            ?: return UrlDecision(LocalDecision.BLOCK, reason = "missing_scheme")

        if (scheme in dangerousSchemes) {
            return UrlDecision(LocalDecision.BLOCK, reason = "dangerous_scheme")
        }

        if (scheme != "https") {
            return UrlDecision(LocalDecision.BLOCK, reason = "https_required")
        }

        if (uri.userInfo != null) {
            return UrlDecision(LocalDecision.BLOCK, reason = "userinfo_not_allowed")
        }

        val rawHost = uri.host
            ?: return UrlDecision(LocalDecision.BLOCK, reason = "missing_host")

        val host = normalizeHost(rawHost)
            ?: return UrlDecision(LocalDecision.BLOCK, reason = "invalid_host")

        val allowed = exactAllowedHosts.contains(host)
        return if (allowed) {
            UrlDecision(LocalDecision.ALLOW, normalizedHost = host, reason = "exact_allow")
        } else {
            UrlDecision(LocalDecision.BLOCK, normalizedHost = host, reason = "not_in_local_policy")
        }
    }

    private fun normalizeHost(raw: String): String? {
        return try {
            val noTrailingDot = raw.trim().trimEnd('.')
            if (noTrailingDot.isBlank()) return null
            IDN.toASCII(noTrailingDot, IDN.USE_STD3_ASCII_RULES)
                .lowercase(Locale.US)
                .takeIf { it.length in 1..253 }
        } catch (_: Exception) {
            null
        }
    }
}
