package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FactoryResetProtectionManagerTest {

    @Test
    fun normalizeAccounts_trimsDropsBlankAndDeduplicates() {
        assertEquals(
            listOf("account-a", "account-b"),
            FactoryResetProtectionManager.normalizeAccounts(
                listOf(" account-a ", "", "account-b", "account-a", "   "),
            ),
        )
    }

    @Test
    fun normalizeAccounts_rejectsTooManyAccounts() {
        assertThrows(IllegalArgumentException::class.java) {
            FactoryResetProtectionManager.normalizeAccounts(
                (1..11).map { "account-$it" },
            )
        }
    }

    @Test
    fun normalizeAccounts_rejectsOversizedIdentifier() {
        assertThrows(IllegalArgumentException::class.java) {
            FactoryResetProtectionManager.normalizeAccounts(
                listOf("x".repeat(321)),
            )
        }
    }
}
