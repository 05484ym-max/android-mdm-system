package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivilegeProviderResolverTest {

    private fun profile(capabilities: Set<DeviceCapability>) = DeviceProfile(
        manufacturer = "test",
        brand = "test",
        model = "test",
        device = "test",
        product = "test",
        buildDisplay = "test",
        sdkInt = 34,
        androidRelease = "14",
        oemSkin = "aosp_generic",
        oemSkinVersion = null,
        capabilities = capabilities,
    )

    @Test
    fun `priv app wins over every other provider`() {
        val result = PrivilegeProviderResolver.resolve(
            profile(
                setOf(
                    DeviceCapability.PRIV_APP,
                    DeviceCapability.DEVICE_OWNER,
                    DeviceCapability.ROOT,
                )
            )
        )
        assertEquals(PrivilegeProviderType.PRIV_APP, result.type)
        assertTrue(result.verified)
    }

    @Test
    fun `device owner is verified when observed`() {
        val result = PrivilegeProviderResolver.resolve(
            profile(setOf(DeviceCapability.DEVICE_OWNER))
        )
        assertEquals(PrivilegeProviderType.DEVICE_OWNER, result.type)
        assertTrue(result.verified)
    }

    @Test
    fun `root is only a candidate not verified systemless install`() {
        val result = PrivilegeProviderResolver.resolve(
            profile(setOf(DeviceCapability.ROOT))
        )
        assertEquals(PrivilegeProviderType.ROOT_SYSTEMLESS, result.type)
        assertFalse(result.verified)
    }

    @Test
    fun `legacy admin selects accessibility admin provider`() {
        val result = PrivilegeProviderResolver.resolve(
            profile(setOf(DeviceCapability.DEVICE_ADMIN))
        )
        assertEquals(PrivilegeProviderType.ACCESSIBILITY_ADMIN, result.type)
        assertTrue(result.verified)
    }
}
