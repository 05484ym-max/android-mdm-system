package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TargetedNonDoSetupPlannerTest {

    @Test
    fun `hardened requests home accessibility and OEM setup`() {
        val plan = TargetedNonDoSetupPlanner.build(profile(setOf(DeviceCapability.LAUNCHER)), "samsung.oneui", "HARDENED")
        assertEquals(
            listOf(
                NonDoSetupStep.SET_DEFAULT_HOME,
                NonDoSetupStep.ENABLE_ACCESSIBILITY,
                NonDoSetupStep.OEM_BACKGROUND_SETUP,
                NonDoSetupStep.VERIFY_PROTECTION,
            ),
            plan.steps,
        )
        assertFalse(plan.requiresReprovisioning)
    }

    @Test
    fun `hardened admin adds device admin`() {
        val caps = setOf(DeviceCapability.LAUNCHER, DeviceCapability.DEFAULT_HOME, DeviceCapability.ACCESSIBILITY)
        val plan = TargetedNonDoSetupPlanner.build(profile(caps), "qin.f21pro", "HARDENED_ADMIN")
        assertTrue(NonDoSetupStep.ACTIVATE_DEVICE_ADMIN in plan.steps)
        assertTrue(NonDoSetupStep.OEM_BACKGROUND_SETUP in plan.steps)
    }

    @Test
    fun `device owner target never attempts silent provisioning`() {
        val plan = TargetedNonDoSetupPlanner.build(profile(setOf(DeviceCapability.LAUNCHER)), "xiaomi.hyperos", "DEVICE_OWNER")
        assertEquals(listOf(NonDoSetupStep.VERIFY_PROTECTION), plan.steps)
        assertTrue(plan.requiresReprovisioning)
    }

    @Test
    fun `system target never attempts flashing or root`() {
        val plan = TargetedNonDoSetupPlanner.build(profile(setOf(DeviceCapability.LAUNCHER, DeviceCapability.ROOT)), "qin.f22pro", "SYSTEM_LEVEL")
        assertEquals(listOf(NonDoSetupStep.VERIFY_PROTECTION), plan.steps)
        assertTrue(plan.requiresSystemIntegration)
        assertEquals("BASIC", plan.achieved.achievedProfile)
    }

    @Test
    fun `priv app alone does not satisfy system target`() {
        val plan = TargetedNonDoSetupPlanner.build(
            profile(setOf(DeviceCapability.LAUNCHER, DeviceCapability.PRIV_APP)),
            "qin.f22pro",
            "SYSTEM_LEVEL",
        )
        assertTrue(plan.requiresSystemIntegration)
        assertTrue(plan.achieved.privilegedAppVerified)
        assertFalse(plan.achieved.systemEnforcementVerified)
        assertEquals("BASIC", plan.achieved.achievedProfile)
    }

    @Test
    fun `verified system enforcement satisfies system target`() {
        val plan = TargetedNonDoSetupPlanner.build(
            profile(setOf(DeviceCapability.LAUNCHER, DeviceCapability.PRIV_APP, DeviceCapability.SYSTEM_ENFORCEMENT)),
            "qin.f22pro",
            "SYSTEM_LEVEL",
        )
        assertFalse(plan.requiresSystemIntegration)
        assertTrue(plan.achieved.systemEnforcementVerified)
        assertEquals("SYSTEM_LEVEL", plan.achieved.achievedProfile)
    }

    @Test
    fun `existing device owner satisfies device owner target without reprovisioning`() {
        val plan = TargetedNonDoSetupPlanner.build(profile(setOf(DeviceCapability.LAUNCHER, DeviceCapability.DEVICE_OWNER)), "samsung.oneui", "DEVICE_OWNER")
        assertFalse(plan.requiresReprovisioning)
    }

    private fun profile(capabilities: Set<DeviceCapability>) = DeviceProfile(
        manufacturer = "test",
        brand = "test",
        model = "test",
        device = "test",
        product = "test",
        buildDisplay = "test",
        sdkInt = 35,
        androidRelease = "15",
        oemSkin = "test",
        oemSkinVersion = null,
        capabilities = capabilities,
    )
}
