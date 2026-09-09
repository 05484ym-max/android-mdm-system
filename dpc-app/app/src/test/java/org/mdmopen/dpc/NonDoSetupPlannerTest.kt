package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NonDoSetupPlannerTest {

    private fun profile(capabilities: Set<DeviceCapability>) = DeviceProfile(
        manufacturer = "Xiaomi",
        brand = "Xiaomi",
        model = "test",
        device = "test",
        product = "test",
        buildDisplay = "test",
        sdkInt = 34,
        androidRelease = "14",
        oemSkin = "xiaomi_hyperos",
        oemSkinVersion = "2",
        capabilities = capabilities,
    )

    @Test
    fun `fresh non-do device gets ordered setup steps`() {
        val plan = NonDoSetupPlanner.build(
            profile(setOf(DeviceCapability.LAUNCHER)),
            "xiaomi.hyperos",
        )

        assertFalse(plan.alreadyDeviceOwner)
        assertEquals(
            listOf(
                NonDoSetupStep.SET_DEFAULT_HOME,
                NonDoSetupStep.ENABLE_ACCESSIBILITY,
                NonDoSetupStep.ACTIVATE_DEVICE_ADMIN,
                NonDoSetupStep.OEM_BACKGROUND_SETUP,
                NonDoSetupStep.VERIFY_PROTECTION,
            ),
            plan.steps,
        )
    }

    @Test
    fun `already hardened admin skips completed android steps`() {
        val plan = NonDoSetupPlanner.build(
            profile(
                setOf(
                    DeviceCapability.LAUNCHER,
                    DeviceCapability.DEFAULT_HOME,
                    DeviceCapability.ACCESSIBILITY,
                    DeviceCapability.DEVICE_ADMIN,
                )
            ),
            "xiaomi.hyperos",
        )

        assertEquals(
            listOf(
                NonDoSetupStep.OEM_BACKGROUND_SETUP,
                NonDoSetupStep.VERIFY_PROTECTION,
            ),
            plan.steps,
        )
        assertEquals("HARDENED_ADMIN", plan.achieved.profile.name)
    }

    @Test
    fun `device owner does not enter non-do provisioning`() {
        val plan = NonDoSetupPlanner.build(
            profile(setOf(DeviceCapability.LAUNCHER, DeviceCapability.DEVICE_OWNER)),
            "xiaomi.hyperos",
        )

        assertTrue(plan.alreadyDeviceOwner)
        assertEquals(listOf(NonDoSetupStep.VERIFY_PROTECTION), plan.steps)
        assertEquals("DEVICE_OWNER", plan.achieved.profile.name)
    }

    @Test
    fun `generic aosp has no oem background step`() {
        val plan = NonDoSetupPlanner.build(
            profile(
                setOf(
                    DeviceCapability.LAUNCHER,
                    DeviceCapability.DEFAULT_HOME,
                    DeviceCapability.ACCESSIBILITY,
                    DeviceCapability.DEVICE_ADMIN,
                )
            ),
            "aosp.generic",
        )

        assertEquals(listOf(NonDoSetupStep.VERIFY_PROTECTION), plan.steps)
    }
}
