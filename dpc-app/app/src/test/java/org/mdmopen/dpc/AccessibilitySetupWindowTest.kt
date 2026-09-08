package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilitySetupWindowTest {
    @Test
    fun normal_call_is_blocked_while_setup_window_is_active() {
        assertFalse(AccessibilitySetupWindow.shouldRestoreAllowlist(setupActive = true, force = false))
    }

    @Test
    fun normal_call_restores_when_no_setup_window_is_active() {
        assertTrue(AccessibilitySetupWindow.shouldRestoreAllowlist(setupActive = false, force = false))
    }

    @Test
    fun forced_call_always_restores_even_during_an_active_setup_window() {
        assertTrue(AccessibilitySetupWindow.shouldRestoreAllowlist(setupActive = true, force = true))
    }

    @Test
    fun forced_call_restores_when_no_setup_window_is_active() {
        assertTrue(AccessibilitySetupWindow.shouldRestoreAllowlist(setupActive = false, force = true))
    }
}
