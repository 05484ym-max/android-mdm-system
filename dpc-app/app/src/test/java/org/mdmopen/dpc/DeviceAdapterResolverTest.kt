package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceAdapterResolverTest {

    @Test
    fun `resolves Samsung One UI`() {
        val selection = DeviceAdapterResolver.resolve(profile("samsung_oneui"))
        assertEquals("samsung.oneui", selection.adapterId)
        assertTrue(selection.confidence >= 90)
    }

    @Test
    fun `resolves Xiaomi HyperOS`() {
        val selection = DeviceAdapterResolver.resolve(profile("xiaomi_hyperos"))
        assertEquals("xiaomi.hyperos", selection.adapterId)
    }

    @Test
    fun `resolves Qin F21 Pro before generic fallback`() {
        val selection = DeviceAdapterResolver.resolve(profile("qin_f21pro"))
        assertEquals("qin.f21pro", selection.adapterId)
        assertEquals(99, selection.confidence)
    }

    @Test
    fun `resolves Qin F22 Pro before generic fallback`() {
        val selection = DeviceAdapterResolver.resolve(profile("qin_f22pro"))
        assertEquals("qin.f22pro", selection.adapterId)
        assertEquals(99, selection.confidence)
    }

    @Test
    fun `unknown OEM falls back to generic AOSP`() {
        val selection = DeviceAdapterResolver.resolve(profile("unknown_skin"))
        assertEquals("aosp.generic", selection.adapterId)
        assertEquals(10, selection.confidence)
    }

    private fun profile(skin: String) = DeviceProfile(
        manufacturer = "test",
        brand = "test",
        model = "test",
        device = "test",
        product = "test",
        buildDisplay = "test",
        sdkInt = 35,
        androidRelease = "15",
        oemSkin = skin,
        oemSkinVersion = null,
        capabilities = setOf(DeviceCapability.LAUNCHER),
    )
}
