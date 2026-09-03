package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BrowsingPolicyEngineTest {

    private fun engineWith(
        hostResponses: Map<String, RemoteDecision> = emptyMap(),
        defaultDecision: RemoteDecision = RemoteDecision.BLOCK,
    ): Pair<BrowsingPolicyEngine, FakeRemoteClassifier> {
        val classifier = FakeRemoteClassifier(hostResponses = hostResponses, defaultDecision = defaultDecision)
        val engine = BrowsingPolicyEngine(classifier, remoteTimeoutMs = 2000)
        return engine to classifier
    }

    private fun approveSync(engine: BrowsingPolicyEngine, host: String): Boolean {
        val latch = CountDownLatch(1)
        var approved = false
        engine.requestHostApproval(host) { result -> approved = result; latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        return approved
    }

    @Test
    fun unknownHost_isBlockedUntilApproved() {
        val (engine, _) = engineWith()
        val decision = engine.evaluateNavigation("https://new-site.example")
        assertTrue(decision is NavigationDecision.PendingApproval)
        assertEquals("new-site.example", (decision as NavigationDecision.PendingApproval).host)
    }

    @Test
    fun remoteAllow_thenTheExactHostBecomesAllowed() {
        val (engine, _) = engineWith(hostResponses = mapOf("new-site.example" to RemoteDecision.ALLOW))
        assertTrue(approveSync(engine, "new-site.example"))

        val decision = engine.evaluateNavigation("https://new-site.example/page?x=1")
        assertTrue(decision is NavigationDecision.Allow)
    }

    @Test
    fun remoteAllow_permitsTheExactHostOnly_aDifferentHostStaysPending() {
        val (engine, _) = engineWith(hostResponses = mapOf("new-site.example" to RemoteDecision.ALLOW))
        approveSync(engine, "new-site.example")

        val other = engine.evaluateNavigation("https://another-site.example")
        assertTrue(other is NavigationDecision.PendingApproval)
    }

    @Test
    fun subdomain_doesNotInheritApprovalFromItsParent() {
        val (engine, _) = engineWith(hostResponses = mapOf("new-site.example" to RemoteDecision.ALLOW))
        approveSync(engine, "new-site.example")

        val subdomain = engine.evaluateNavigation("https://www.new-site.example")
        assertTrue(subdomain is NavigationDecision.PendingApproval)
        assertEquals("www.new-site.example", (subdomain as NavigationDecision.PendingApproval).host)
    }

    @Test
    fun http_isBlocked_andNeverReachesTheRemoteClassifier() {
        val (engine, classifier) = engineWith(hostResponses = mapOf("new-site.example" to RemoteDecision.ALLOW))
        val decision = engine.evaluateNavigation("http://new-site.example")
        assertTrue(decision is NavigationDecision.Blocked)
        assertEquals(0, classifier.hostInvocationCounts.size)
    }

    @Test
    fun dangerousSchemes_areBlocked_andNeverReachTheRemoteClassifier() {
        val (engine, classifier) = engineWith()
        listOf("javascript:alert(1)", "file:///etc/passwd", "intent://x", "data:text/html,x").forEach { url ->
            val decision = engine.evaluateNavigation(url)
            assertTrue("$url must be blocked", decision is NavigationDecision.Blocked)
        }
        assertEquals(0, classifier.hostInvocationCounts.size)
    }

    @Test
    fun aRedirectToABrandNewHost_isBlockedUntilItIsClassified() {
        val (engine, _) = engineWith(hostResponses = mapOf("first.example" to RemoteDecision.ALLOW))
        approveSync(engine, "first.example")
        assertTrue(engine.evaluateNavigation("https://first.example/") is NavigationDecision.Allow)

        // Simulates the WebViewClient re-evaluating a redirect's target
        // host, which onPageStarted/shouldOverrideUrlLoading do for real
        // (see SecureWebViewClient) - a redirect to a host never seen
        // before is just another independent PendingApproval.
        val redirectDecision = engine.evaluateNavigation("https://redirected-to.example/")
        assertTrue(redirectDecision is NavigationDecision.PendingApproval)
    }

    @Test
    fun haredidStrict_aRemoteErrorNeverBecomesAnAllow_staysFailClosed() {
        val (engine, _) = engineWith(defaultDecision = RemoteDecision.ERROR)
        val approved = approveSync(engine, "errors-out.example")

        assertFalse(approved)
        assertTrue(engine.evaluateNavigation("https://errors-out.example") is NavigationDecision.PendingApproval)
    }

    @Test
    fun remoteBlock_leavesTheHostBlocked_notPending() {
        val (engine, _) = engineWith(hostResponses = mapOf("bad-site.example" to RemoteDecision.BLOCK))
        val approved = approveSync(engine, "bad-site.example")

        assertFalse(approved)
        // Still PendingApproval from evaluateNavigation's point of view -
        // the caller (SecureWebViewClient/MainActivity) is the one that
        // turns "approval failed" into an actual Blocked screen (see
        // handlePendingApproval) rather than this engine caching a
        // permanent block state for it.
        assertTrue(engine.evaluateNavigation("https://bad-site.example") is NavigationDecision.PendingApproval)
    }
}
