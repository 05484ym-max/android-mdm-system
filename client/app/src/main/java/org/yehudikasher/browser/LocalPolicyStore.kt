package org.yehudikasher.browser

object LocalPolicyStore {
    fun createPolicy(): UrlPolicy {
        // Search is no longer granted a whole-host allow rule. UrlPolicy has a
        // narrow strict-search URL fast-path that only accepts the exact
        // browser-generated DuckDuckGo query shape with Safe Search forced on.
        val debugAllowlist = if (BuildConfig.DEBUG) {
            listOf(
                LocalPolicyRule("example.com"),
                LocalPolicyRule("example.org", allowSubdomains = true)
            )
        } else {
            emptyList()
        }

        return UrlPolicy(debugAllowlist)
    }
}
