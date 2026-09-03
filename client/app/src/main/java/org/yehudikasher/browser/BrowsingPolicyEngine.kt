package org.yehudikasher.browser

/** What a navigation attempt resolves to. Allow/Blocked mirror UrlPolicy's
 * own two outcomes exactly; PendingApproval is the new middle state this
 * engine adds - a URL that passed every structural safety check (https,
 * real host, no dangerous scheme, no IP literal, default port, ...) but
 * isn't in the current approved-hosts set yet, so it needs a remote
 * classification before it can load. */
sealed class NavigationDecision {
    object Allow : NavigationDecision()
    data class Blocked(val reason: String) : NavigationDecision()
    data class PendingApproval(val host: String) : NavigationDecision()
}

/**
 * Composes the existing, unchanged UrlPolicy (every structural fail-closed
 * rule - https-only, dangerous-scheme/IP-literal/port/userinfo/backslash
 * rejection, subdomain-boundary matching - stays exactly as already
 * shipped and already tested) with a remote, per-host approval flow:
 *
 *  - A host UrlPolicy would already ALLOW (it's in the current
 *    approved-hosts set) stays instantly allowed - no remote call.
 *  - A host UrlPolicy rejects for any HARD reason (wrong scheme, IP
 *    literal, non-default port, malformed, ...) is rejected outright - it
 *    is never sent to the remote classifier, and no remote decision can
 *    ever override it. This is what makes "an unknown iframe/subresource
 *    can never bypass policy" and "dangerous schemes/HTTP are always
 *    blocked" true regardless of what the server ever says.
 *  - Only a host that is otherwise completely fine, just not approved yet
 *    (UrlPolicy's "not_in_local_policy" reason) becomes PendingApproval -
 *    the one case this engine actually asks the remote classifier about.
 *
 * A host that resolves ALLOW remotely is added to the approved set and a
 * fresh UrlPolicy is rebuilt from LocalPolicyStore.baseRules() plus every
 * approved host so far - each added as an exact-host rule (allowSubdomains
 * = false), so approving example.com never silently approves
 * www.example.com; that subdomain gets its own, independent check the
 * first time it's actually navigated to.
 */
class BrowsingPolicyEngine(
    private val classifier: RemoteClassifier,
    private val filterLevel: () -> FilterLevel = { FilterLevel.HAREDI_STRICT },
    private val remoteTimeoutMs: Long = DEFAULT_REMOTE_TIMEOUT_MS,
    poolSize: Int = 4,
) {
    private val gate = RemotePolicyGate(classifier, poolSize)

    @Volatile
    private var approvedHosts: Set<String> = emptySet()

    @Volatile
    private var localPolicy: UrlPolicy = UrlPolicy(LocalPolicyStore.baseRules())

    fun currentFilterLevel(): FilterLevel = filterLevel()

    fun evaluateNavigation(url: String?): NavigationDecision {
        val result = localPolicy.evaluate(url)
        return when {
            result.decision == LocalDecision.ALLOW -> NavigationDecision.Allow
            result.reason == NOT_YET_APPROVED_REASON && result.normalizedHost != null ->
                NavigationDecision.PendingApproval(result.normalizedHost)
            else -> NavigationDecision.Blocked(result.reason)
        }
    }

    /**
     * Only ever called for a host evaluateNavigation just returned
     * PendingApproval for. Runs the remote check off the caller's thread
     * (via RemotePolicyGate's bounded executor) and invokes `callback`
     * with the outcome - true only for a real remote ALLOW; ERROR and
     * BLOCK both resolve to false, matching "ERROR = BLOCK" for
     * everything this engine gates.
     */
    fun requestHostApproval(host: String, callback: (Boolean) -> Unit) {
        gate.checkHostAsync(host, remoteTimeoutMs) { decision ->
            if (decision == RemoteDecision.ALLOW) {
                approveHost(host)
            }
            callback(decision == RemoteDecision.ALLOW)
        }
    }

    /** Blocking - only ever called from shouldInterceptRequest, which
     * WebView already guarantees runs off the main thread, so a bounded
     * wait here (see RemotePolicyGate's own timeout handling) never risks
     * freezing the UI. */
    fun evaluateImage(url: String): RemoteDecision = gate.checkImageBlocking(url, remoteTimeoutMs)

    @Synchronized
    private fun approveHost(host: String) {
        if (host in approvedHosts) return
        approvedHosts = approvedHosts + host
        localPolicy = UrlPolicy(LocalPolicyStore.baseRules() + approvedHosts.map { LocalPolicyRule(it) })
    }

    companion object {
        private const val NOT_YET_APPROVED_REASON = "not_in_local_policy"
        const val DEFAULT_REMOTE_TIMEOUT_MS = 4_000L
    }
}
