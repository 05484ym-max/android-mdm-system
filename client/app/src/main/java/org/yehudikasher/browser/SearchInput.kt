package org.yehudikasher.browser

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Resolves omnibox input without weakening the existing URL policy.
 *
 * - Explicit http/https URLs stay URLs.
 * - Host-like input (for example bankhapoalim.co.il) becomes https://...
 * - Everything else becomes a strict Safe Search query.
 *
 * The resolved URL is still passed to UrlPolicy / remote classification by
 * MainActivity, so this helper never grants access by itself.
 */
object SearchInput {
    // DuckDuckGo's dedicated safe host forces Safe Search. We also explicitly
    // request strict mode, Israel/Hebrew region, no automatic image loading,
    // and no autocomplete to keep the search page lean and conservative.
    private const val SEARCH_ENDPOINT =
        "https://safe.duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q="

    fun resolve(rawInput: String): String {
        val raw = rawInput.trim()
        if (raw.isEmpty()) return ""

        if (raw.startsWith("http://", ignoreCase = true) ||
            raw.startsWith("https://", ignoreCase = true)
        ) {
            return raw
        }

        if (looksLikeHost(raw)) {
            return "https://$raw"
        }

        val encoded = URLEncoder.encode(raw, StandardCharsets.UTF_8.name())
        return SEARCH_ENDPOINT + encoded
    }

    internal fun looksLikeHost(raw: String): Boolean {
        if (raw.any { it.isWhitespace() }) return false
        if (raw.contains('/')) return false
        if (raw.startsWith(".") || raw.endsWith(".")) return false

        // Treat dotted hostnames as direct navigation. IP literals are still
        // rejected later by UrlPolicy, so this helper does not create a bypass.
        return raw.contains('.') && raw.length >= 3
    }
}
