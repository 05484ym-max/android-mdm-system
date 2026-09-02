package org.yehudikasher.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    private val policy = UrlPolicy(setOf("example.com"))

    @Test
    fun exactAllowedHttpsHost_isAllowed() {
        assertEquals(LocalDecision.ALLOW, policy.evaluate("https://example.com").decision)
    }

    @Test
    fun subdomain_isBlockedByDefault() {
        assertEquals(LocalDecision.BLOCK, policy.evaluate("https://www.example.com").decision)
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
    fun trailingDot_isNormalized() {
        assertEquals(
            LocalDecision.ALLOW,
            policy.evaluate("https://EXAMPLE.com./").decision
        )
    }
}
