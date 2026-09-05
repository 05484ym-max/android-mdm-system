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
 * The resolved URL is still passed to UrlPolicy / remote classification by
 * MainActivity, so this helper never grants access by itself.
 */
object SearchInput {
    // Use DuckDuckGo's non-JavaScript HTML surface on the dedicated safe host.
    // The safe host forces strict Safe Search, while the HTML surface avoids
    // relying on the regular JS-heavy search page inside the hardened WebView.
    // Extra conservative parameters keep the page lean and region-aware.
    private const val SEARCH_ENDPOINT =
        "https://safe.duckduckgo.com/html/?kp=1&kl=il-he&kc=-1&kac=-1&q="

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
