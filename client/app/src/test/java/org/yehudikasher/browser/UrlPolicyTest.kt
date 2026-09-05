package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UrlPolicyTest {
    private val policy = UrlPolicy(
        listOf(
            LocalPolicyRule("example.com"),
            LocalPolicyRule("allowed.example.org", allowSubdomains = true)
        )
    )

    @Test
    fun exactAllowedHttpsHost_isAllowed() {
        val result = policy.evaluate("https://example.com/path")
        assertEquals(LocalDecision.ALLOW, result.decision)
        assertEquals("example.com", result.normalizedHost)
    }

    @Test
    fun exactGeneratedStrictSearchUrl_isAllowed() {
        val result = policy.evaluate(
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=%D7%91%D7%A0%D7%A7+%D7%94%D7%A4%D7%95%D7%A2%D7%9C%D7%99%D7%9D"
        )
        assertEquals(LocalDecision.ALLOW, result.decision)
        assertEquals("duckduckgo.com", result.normalizedHost)
        assertEquals("strict_search_allow", result.reason)
    }

    @Test
    fun strictSearchRejectsSafeSearchOffOrModerate() {
        listOf("-2", "-1").forEach { unsafeValue ->
            val result = policy.evaluate(
                "https://duckduckgo.com/?kp=$unsafeValue&kl=il-he&kc=-1&kac=-1&q=test"
            )
            assertEquals(LocalDecision.BLOCK, result.decision)
            assertEquals("not_in_local_policy", result.reason)
        }
    }

    @Test
    fun strictSearchRejectsMissingDuplicateOrExtraParameters() {
        val candidates = listOf(
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&q=test",
            "https://duckduckgo.com/?kp=1&kp=-2&kl=il-he&kc=-1&kac=-1&q=test",
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=test&ia=images",
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=",
            "https://duckduckgo.com/?kp=1&kl=il-he&kc=-1&kac=-1&q=test#images"
        )
        candidates.forEach { candidate ->
            assertEquals(candidate, LocalDecision.BLOCK, policy.evaluate(candidate).decision)
        }
    }

    @Test
    fun unrelatedDuckDuckGoPagesAreNotLocallyAllowed() {
        listOf(
            "https://duckduckgo.com/",
            "https://duckduckgo.com/settings",
            "https://duckduckgo.com/?q=test",
            "https://safe.duckduckgo.com/?q=test"
        ).forEach { candidate ->
            assertEquals(candidate, LocalDecision.BLOCK, policy.evaluate(candidate).decision)
        }
    }

    @Test
    fun unknownHost_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://evil.example.net").decision
        )
    }

    @Test
    fun subdomain_isBlockedWhenRuleDoesNotAllowIt() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://www.example.com").decision
        )
    }

    @Test
    fun subdomain_isAllowedOnlyAcrossRealLabelBoundary() {
        assertEquals(
            LocalDecision.ALLOW,
            policy.evaluate("https://deep.allowed.example.org").decision
        )
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://badallowed.example.org.evil.com").decision
        )
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://notallowed.example.org").decision
        )
    }

    @Test
    fun http_isBlocked() {
        assertEquals(LocalDecision.BLOCK, policy.evaluate("http://example.com").decision)
    }

    @Test
    fun dangerousSchemes_areBlocked() {
        listOf(
            "intent://example.com",
            "file:///etc/passwd",
            "data:text/html,test",
            "javascript:alert(1)",
            "blob:https://example.com/id",
            "content://example/path"
        ).forEach {
            assertEquals("$it must be blocked", LocalDecision.BLOCK, policy.evaluate(it).decision)
        }
    }

    @Test
    fun malformedOrMissingHost_isBlocked() {
        listOf("", "https://", "not a url", "https:///path").forEach {
            assertEquals("$it must be blocked", LocalDecision.BLOCK, policy.evaluate(it).decision)
        }
    }

    @Test
    fun userInfo_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://user:pass@example.com").decision
        )
    }

    @Test
    fun ipv4Literal_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://192.168.1.1/").decision
        )
    }

    @Test
    fun ipv6Literal_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://[2001:db8::1]/").decision
        )
    }

    @Test
    fun backslashConfusion_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://example.com\\@evil.com/").decision
        )
    }

    @Test
    fun nonDefaultHttpsPort_isBlocked() {
        assertEquals(
            LocalDecision.BLOCK,
            policy.evaluate("https://example.com:8443/").decision
        )
        assertEquals(
            LocalDecision.ALLOW,
            policy.evaluate("https://example.com:443/").decision
        )
    }

    @Test
    fun trailingDot_isNormalized() {
        assertEquals(
            LocalDecision.ALLOW,
            policy.evaluate("https://EXAMPLE.com./").decision
        )
    }

    @Test
    fun invalidRulesNeverBecomeAllowRules() {
        assertNull(UrlPolicy.normalizeHost("localhost"))
        assertNull(UrlPolicy.normalizeHost("*.example.com"))
    }

    @Test
    fun remoteApprovedHost_isAllowedAfterExplicitApproval() {
        val dynamic = UrlPolicy(emptyList())
        val before = dynamic.evaluate("https://safe.example.net/path")
        assertEquals(LocalDecision.BLOCK, before.decision)
        assertEquals("not_in_local_policy", before.reason)

        dynamic.rememberRemoteAllow("safe.example.net")

        val after = dynamic.evaluate("https://safe.example.net/path")
        assertEquals(LocalDecision.ALLOW, after.decision)
        assertEquals("remote_allow", after.reason)
    }

    @Test
    fun remoteApprovalDoesNotBypassHttpsOrPortRestrictions() {
        val dynamic = UrlPolicy(emptyList())
        dynamic.rememberRemoteAllow("safe.example.net")

        assertEquals(LocalDecision.BLOCK, dynamic.evaluate("http://safe.example.net").decision)
        assertEquals(LocalDecision.BLOCK, dynamic.evaluate("https://safe.example.net:8443").decision)
    }

    @Test
    fun remoteApprovalIsExactHostOnly() {
        val dynamic = UrlPolicy(emptyList())
        dynamic.rememberRemoteAllow("safe.example.net")

        assertEquals(LocalDecision.ALLOW, dynamic.evaluate("https://safe.example.net").decision)
        assertEquals(LocalDecision.BLOCK, dynamic.evaluate("https://cdn.safe.example.net").decision)
    }

    @Test
    fun overlyLongUrl_isBlocked() {
        val url = "https://example.com/" + "a".repeat(9000)
        assertEquals(LocalDecision.BLOCK, policy.evaluate(url).decision)
    }
}
