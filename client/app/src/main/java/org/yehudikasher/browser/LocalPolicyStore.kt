package org.yehudikasher.browser

object LocalPolicyStore {
    fun createPolicy(): UrlPolicy {
        val trustedSearch = listOf(
            // Dedicated DuckDuckGo Safe Search host. The browser still filters
            // every destination and image independently; this only guarantees
            // the search results page itself can open without a classifier round trip.
            LocalPolicyRule("safe.duckduckgo.com")
        )

        val debugAllowlist = if (BuildConfig.DEBUG) {
            listOf(
                LocalPolicyRule("example.com"),
                LocalPolicyRule("example.org", allowSubdomains = true)
            )
        } else {
            emptyList()
        }

        return UrlPolicy(trustedSearch + debugAllowlist)
    }
}
