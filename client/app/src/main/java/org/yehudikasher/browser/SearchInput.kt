package org.yehudikasher.browser

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Resolves omnibox input without weakening the existing URL policy.
 *
 * - Explicit http/https URLs stay URLs.
 * - Host-like input (including a path/query/fragment) becomes https://...
 * - Everything else becomes a strict Safe Search query.
 *
 * The generated search URL is intentionally constrained and is only granted a
 * local fast-path by UrlPolicy when every required strict-search parameter is
 * present with the expected value. Other DuckDuckGo URLs receive no bypass.
 */
object SearchInput {
    // Use DuckDuckGo's normal hostname with an explicit strict Safe Search
    // parameter. This avoids relying on the dedicated safe subdomain, which
    // can fail to resolve/load on some networks/WebView combinations.
    private const val SEARCH_ENDPOINT =
        "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q="

    fun resolve(rawInput: String): String {
        val raw = rawInput.trim()
        if (raw.isEmpty()) return ""

        if (raw.startsWith("http://", ignoreCase = true) ||
            raw.startsWith("https://", ignoreCase = true)
        ) {
            return raw
        }

        if (looksLikeWebAddress(raw)) {
            return "https://$raw"
        }

        val encoded = URLEncoder.encode(raw, StandardCharsets.UTF_8.name())
        return SEARCH_ENDPOINT + encoded
    }

    internal fun looksLikeWebAddress(raw: String): Boolean {
        if (raw.any { it.isWhitespace() }) return false

        val authority = raw
            .substringBefore('/')
            .substringBefore('?')
            .substringBefore('#')

        if (authority.startsWith(".") || authority.endsWith(".")) return false
        if (authority.length < 3) return false

        // Treat dotted hostnames (with optional path/query/fragment) as direct
        // navigation. IP literals are still rejected later by UrlPolicy, so
        // this helper does not create a bypass.
        return authority.contains('.')
    }
}
