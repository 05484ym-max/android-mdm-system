package org.yehudikasher.browser

object LocalPolicyStore {
    fun createPolicy(): UrlPolicy {
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
