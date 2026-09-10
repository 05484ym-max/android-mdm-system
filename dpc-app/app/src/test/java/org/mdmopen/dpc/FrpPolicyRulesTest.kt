package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FrpPolicyRulesTest {
    @Test
    fun enabledRequiresAtLeastOneAccount() {
        val result = FrpPolicyRules.validate(true, emptyList())
        assertFalse(result.valid)
        assertEquals("ENABLED_WITHOUT_ACCOUNTS_REJECTED", result.error)
    }

    @Test
    fun normalizesAndDeduplicatesAccounts() {
        val result = FrpPolicyRules.validate(true, listOf(" 123 ", "123", "456"))
        assertTrue(result.valid)
        assertEquals(listOf("123", "456"), result.accountIds)
    }

    @Test
    fun rejectsTooManyAccounts() {
        val result = FrpPolicyRules.validate(true, (1..21).map { "id-$it" })
        assertFalse(result.valid)
        assertEquals("TOO_MANY_ACCOUNTS", result.error)
    }

    @Test
    fun disabledPolicyMayHaveNoAccounts() {
        val result = FrpPolicyRules.validate(false, emptyList())
        assertTrue(result.valid)
    }
}
