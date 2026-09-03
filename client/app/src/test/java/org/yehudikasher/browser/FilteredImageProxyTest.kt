package org.yehudikasher.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FilteredImageProxyTest {

    @Test
    fun imageAcceptHeader_isProxied() {
        assertTrue(
            FilteredImageProxy.looksLikeImageRequest(
                isMainFrame = false,
                method = "GET",
                accept = "image/avif,image/webp,image/png,*/*;q=0.8",
                path = "/asset?id=123",
            )
        )
    }

    @Test
    fun imageExtension_isProxiedEvenWithoutAcceptHeader() {
        assertTrue(
            FilteredImageProxy.looksLikeImageRequest(
                isMainFrame = false,
                method = "GET",
                accept = "*/*",
                path = "/images/photo.JPG",
            )
        )
    }

    @Test
    fun mainFrame_isNeverTreatedAsImageResource() {
        assertFalse(
            FilteredImageProxy.looksLikeImageRequest(
                isMainFrame = true,
                method = "GET",
                accept = "image/png",
                path = "/photo.png",
            )
        )
    }

    @Test
    fun nonGetImageRequest_isNotProxied() {
        assertFalse(
            FilteredImageProxy.looksLikeImageRequest(
                isMainFrame = false,
                method = "POST",
                accept = "image/png",
                path = "/photo.png",
            )
        )
    }

    @Test
    fun scriptResource_isNotMistakenForImage() {
        assertFalse(
            FilteredImageProxy.looksLikeImageRequest(
                isMainFrame = false,
                method = "GET",
                accept = "*/*",
                path = "/app.js",
            )
        )
    }
}
