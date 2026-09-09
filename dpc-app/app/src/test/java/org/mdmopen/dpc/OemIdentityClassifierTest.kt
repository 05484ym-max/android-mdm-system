package org.mdmopen.dpc

import org.junit.Assert.assertEquals
import org.junit.Test

class OemIdentityClassifierTest {

    @Test
    fun `Qin F21 wins even when manufacturer and brand report Xiaomi`() {
        val result = OemIdentityClassifier.classify(
            OemIdentityClassifier.Identity(
                manufacturer = "Xiaomi",
                brand = "Xiaomi",
                model = "Qin F21 Pro",
                device = "f21pro",
                product = "duoqin_f21",
                buildDisplay = "Qin F21 Pro build",
                androidRelease = "11",
            ),
            hyperOsVersion = "OS2.0",
            miuiVersion = "V14",
        )

        assertEquals("qin_f21pro", result.first)
        assertEquals("11", result.second)
    }

    @Test
    fun `Qin 3 Ultra wins over Xiaomi branding`() {
        val result = OemIdentityClassifier.classify(
            OemIdentityClassifier.Identity(
                manufacturer = "Xiaomi",
                brand = "Redmi",
                model = "Qin3 Ultra",
                device = "q3u",
                product = "qin3ultra",
                buildDisplay = "release",
                androidRelease = "12",
            ),
            hyperOsVersion = "OS1.0",
        )

        assertEquals("qin_3_ultra", result.first)
    }

    @Test
    fun `normal Xiaomi remains HyperOS`() {
        val result = OemIdentityClassifier.classify(
            OemIdentityClassifier.Identity(
                manufacturer = "Xiaomi",
                brand = "Redmi",
                model = "Redmi Note",
                device = "garnet",
                product = "garnet_global",
                buildDisplay = "HyperOS",
                androidRelease = "15",
            ),
            hyperOsVersion = "OS2.0",
        )

        assertEquals("xiaomi_hyperos", result.first)
        assertEquals("OS2.0", result.second)
    }

    @Test
    fun `Samsung remains One UI`() {
        val result = OemIdentityClassifier.classify(
            OemIdentityClassifier.Identity(
                manufacturer = "samsung",
                brand = "samsung",
                model = "SM-A315F",
                device = "a31",
                product = "a31xx",
                buildDisplay = "build",
                androidRelease = "12",
            ),
            oneUiVersion = "4.1",
        )

        assertEquals("samsung_oneui", result.first)
        assertEquals("4.1", result.second)
    }
}
