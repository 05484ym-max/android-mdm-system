package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ResetProtectionStateTest {

    @Test
    fun `fully enforced requires every Device Owner protection`() {
        val state = ResetProtectionState(
            deviceOwner = true,
            factoryResetBlocked = true,
            safeBootBlocked = true,
            debuggingBlocked = true,
            dpcUninstallBlocked = true,
        )
        assertTrue(state.fullyEnforced)
    }

    @Test
    fun `missing factory reset block fails compliance`() {
        val state = ResetProtectionState(
            deviceOwner = true,
            factoryResetBlocked = false,
            safeBootBlocked = true,
            debuggingBlocked = true,
            dpcUninstallBlocked = true,
        )
        assertFalse(state.fullyEnforced)
    }

    @Test
    fun `non Device Owner never reports full protection`() {
        val state = ResetProtectionState(
            deviceOwner = false,
            factoryResetBlocked = true,
            safeBootBlocked = true,
            debuggingBlocked = true,
            dpcUninstallBlocked = true,
        )
        assertFalse(state.fullyEnforced)
    }
}
