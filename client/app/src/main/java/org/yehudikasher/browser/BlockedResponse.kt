package org.yehudikasher.browser

import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets

object BlockedResponse {
    fun empty(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            403,
            "Blocked",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(ByteArray(0))
        )
    }

    /** Never expose *why* an image was hidden (no reason code, no host, no
     * technical detail) - just this one short, neutral sentence. */
    private const val PLACEHOLDER_TEXT = "התמונה הוסתרה לפי מדיניות הסינון"

    /**
     * A small, self-contained SVG image - no Bitmap/Canvas drawing and no
     * bundled asset file needed, which also keeps this function a plain,
     * pure string builder that's fully unit-testable without any Android
     * framework dependency. Served in place of an image ImageFilterPolicy
     * decided to hide, so the page shows a clean, readable message instead
     * of a broken-image icon.
     */
    fun placeholderImageSvg(): String = """
        <svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
          <rect width="240" height="160" fill="#F2F1E6"/>
          <text x="120" y="80" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="13" fill="#8C8C86">$PLACEHOLDER_TEXT</text>
        </svg>
    """.trimIndent()

    /** The actual WebResourceResponse wrapper around placeholderImageSvg() -
     * status 200 (not 403 like empty() above), since this is a real,
     * intentional image response being served, not an error. */
    fun placeholderImage(): WebResourceResponse {
        val bytes = placeholderImageSvg().toByteArray(StandardCharsets.UTF_8)
        return WebResourceResponse(
            "image/svg+xml",
            "utf-8",
            200,
            "OK",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(bytes)
        )
    }
}
