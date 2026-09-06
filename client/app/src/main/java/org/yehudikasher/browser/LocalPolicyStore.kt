package org.yehudikasher.browser

object LocalPolicyStore {
    fun createPolicy(): UrlPolicy {
        val trustedSearch = listOf(
            // Dedicated DuckDuckGo Safe Search host. The browser still filters
            // every destination and image independently; this only guarantees
            // the search results page itself can open without a classifier round trip.
            LocalPolicyRule("safe.duckduckgo.com")
        )

        // Exact-host essential services that must remain usable even when the
        // remote category classifier is temporarily unavailable. These rules
        // never bypass HTTPS enforcement, image moderation, Safe Browsing, or
        // any other WebView hardening. No wildcard/subdomain inheritance.
        val essentialServices = listOf(
            LocalPolicyRule("egged.co.il"),
            LocalPolicyRule("www.egged.co.il")
        )

        val debugAllowlist = if (BuildConfig.DEBUG) {
            listOf(
                LocalPolicyRule("example.com"),
                LocalPolicyRule("example.org", allowSubdomains = true)
            )
        } else {
            emptyList()
        }

        return UrlPolicy(trustedSearch + essentialServices + debugAllowlist)
    }
}
