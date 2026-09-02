package org.yehudikasher.browser

object LocalPolicyStore {
    fun createPolicy(): UrlPolicy {
        val debugAllowlist = if (BuildConfig.DEBUG) {
            setOf("example.com")
        } else {
            emptySet()
        }

        return UrlPolicy(debugAllowlist)
    }
}
