package org.mdmopen.filteredbrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NavigationPolicyTest {
    private val policy = NavigationPolicy(
        listOf(
            PolicyRule("example.com"),
            PolicyRule("allowed.example.org", allowSubdomains = true),
        ),
    )

    @Test fun exactHttpsHostAllowed() {
        val result = policy.evaluate("https://example.com/path")
        assertEquals(NavigationDecision.ALLOW, result.decision)
        assertEquals("example.com", result.normalizedHost)
    }

    @Test fun unknownHostBlocked() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("https://evil.example.net").decision)
    }

    @Test fun subdomainBlockedWhenNotEnabled() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("https://sub.example.com").decision)
    }

    @Test fun subdomainAllowedOnlyWithBoundary() {
        assertEquals(NavigationDecision.ALLOW, policy.evaluate("https://sub.allowed.example.org").decision)
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("https://badallowed.example.org.evil.com").decision)
    }

    @Test fun httpBlocked() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("http://example.com").decision)
    }

    @Test fun dangerousSchemesBlocked() {
        listOf(
            "intent://scan/",
            "file:///sdcard/a.html",
            "data:text/html,test",
            "javascript:alert(1)",
            "blob:https://example.com/id",
        ).forEach { url ->
            assertEquals(url + " should be blocked", NavigationDecision.BLOCK, policy.evaluate(url).decision)
        }
    }

    @Test fun userInfoConfusionBlocked() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("https://example.com@evil.com/").decision)
    }

    @Test fun ipLiteralBlocked() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("https://192.168.1.1/").decision)
    }

    @Test fun malformedBlocked() {
        assertEquals(NavigationDecision.BLOCK, policy.evaluate("not a url").decision)
    }

    @Test fun hostNormalizationRejectsSingleLabelAndWildcard() {
        assertNull(NavigationPolicy.normalizeHost("localhost"))
        assertNull(NavigationPolicy.normalizeHost("*.example.com"))
    }

    @Test fun trailingDotNormalizes() {
        assertEquals("example.com", NavigationPolicy.normalizeHost("EXAMPLE.COM."))
    }
}
