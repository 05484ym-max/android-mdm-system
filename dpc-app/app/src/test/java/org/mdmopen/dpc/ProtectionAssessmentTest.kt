package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectionAssessmentTest {

    @Test
    fun `basic launcher does not overclaim uninstall protection`() {
        val result = ProtectionAssessmentResolver.from(setOf(DeviceCapability.LAUNCHER))
        assertEquals(UninstallProtection.NONE, result.uninstallProtection)
        assertEquals("BASIC", result.achievedProfile)
    }

    @Test
    fun `default home plus accessibility is best effort only`() {
        val result = ProtectionAssessmentResolver.from(
            setOf(
                DeviceCapability.LAUNCHER,
                DeviceCapability.DEFAULT_HOME,
                DeviceCapability.ACCESSIBILITY,
            )
        )
        assertEquals(UninstallProtection.BEST_EFFORT, result.uninstallProtection)
        assertEquals("HARDENED", result.achievedProfile)
    }

    @Test
    fun `device admin is reported as admin gated`() {
        val result = ProtectionAssessmentResolver.from(
            setOf(DeviceCapability.LAUNCHER, DeviceCapability.DEVICE_ADMIN)
        )
        assertEquals(UninstallProtection.ADMIN_GATED, result.uninstallProtection)
        assertEquals("HARDENED_ADMIN", result.achievedProfile)
        assertTrue(result.deviceAdminVerified)
    }

    @Test
    fun `device owner takes precedence over device admin`() {
        val result = ProtectionAssessmentResolver.from(
            setOf(DeviceCapability.DEVICE_ADMIN, DeviceCapability.DEVICE_OWNER)
        )
        assertEquals(UninstallProtection.DEVICE_OWNER_ENFORCED, result.uninstallProtection)
        assertEquals("DEVICE_OWNER", result.achievedProfile)
    }

    @Test
    fun `privileged app is the strongest observed uninstall protection`() {
        val result = ProtectionAssessmentResolver.from(
            setOf(DeviceCapability.DEVICE_OWNER, DeviceCapability.PRIV_APP)
        )
        assertEquals(UninstallProtection.SYSTEM_LEVEL, result.uninstallProtection)
        assertEquals("SYSTEM_LEVEL", result.achievedProfile)
    }

    @Test
    fun `root alone is observed but never treated as system enforcement`() {
        val result = ProtectionAssessmentResolver.from(
            setOf(DeviceCapability.LAUNCHER, DeviceCapability.ROOT)
        )
        assertEquals(UninstallProtection.NONE, result.uninstallProtection)
        assertTrue(result.rootObserved)
        assertFalse(result.privilegedAppVerified)
    }
}
