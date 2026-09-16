package org.mdmopen.dpc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WallpaperBrandingRetryWorkerTest {

    @Test
    fun `successful branding stops retry chain`() {
        assertTrue(
            WallpaperBrandingRetryWorker.isTerminalSuccess(
                "Android 12 · OK H:1→2 L:3→4 · src=file/shared-home"
            )
        )
    }

    @Test
    fun `already branded stops retry chain`() {
        assertTrue(
            WallpaperBrandingRetryWorker.isTerminalSuccess(
                "Android 12 · כבר מעודכן · H=2 L=4"
            )
        )
    }

    @Test
    fun `fresh enrollment read failure keeps retrying`() {
        assertFalse(
            WallpaperBrandingRetryWorker.isTerminalSuccess(
                "Android 12 · HOME_READ_FAIL · H=1 · perm=false"
            )
        )
    }

    @Test
    fun `write failure keeps retrying`() {
        assertFalse(
            WallpaperBrandingRetryWorker.isTerminalSuccess(
                "Android 12 · WRITE_FAIL H:1→1 L:3→3 · src=file/shared-home"
            )
        )
    }
}
