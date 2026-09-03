package org.yehudikasher.browser

object LocalPolicyStore {
    /** The fixed rules every UrlPolicy this app builds starts from -
     * BrowsingPolicyEngine layers remotely-approved hosts on top of this
     * same base each time it rebuilds its policy (see
     * BrowsingPolicyEngine.rebuildPolicy), so debug-only convenience hosts
     * are never lost just because a real host got approved. */
    fun baseRules(): List<LocalPolicyRule> {
        return if (BuildConfig.DEBUG) {
            listOf(
                LocalPolicyRule("example.com"),
                LocalPolicyRule("example.org", allowSubdomains = true)
            )
        } else {
            emptyList()
        }
    }

    fun createPolicy(): UrlPolicy = UrlPolicy(baseRules())
}
