package org.yehudikasher.browser

import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

object BlockedResponse {
    private val placeholderSvg = (
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\" viewBox=\"0 0 640 360\">" +
        "<rect width=\"640\" height=\"360\" rx=\"24\" fill=\"#f2f1e6\"/>" +
        "<rect x=\"18\" y=\"18\" width=\"604\" height=\"324\" rx=\"20\" fill=\"none\" stroke=\"#d8d4bd\" stroke-width=\"2\"/>" +
        "<text x=\"320\" y=\"172\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"24\" fill=\"#4b6b45\">התמונה הוסתרה</text>" +
        "<text x=\"320\" y=\"208\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"17\" fill=\"#77766f\">לפי מדיניות הסינון</text>" +
        "</svg>"
    ).toByteArray(Charsets.UTF_8)

    fun imagePlaceholder(): WebResourceResponse {
        return WebResourceResponse(
            "image/svg+xml",
            "utf-8",
            200,
            "OK",
            mapOf(
                "Cache-Control" to "private, max-age=300",
                "X-Content-Type-Options" to "nosniff",
            ),
            ByteArrayInputStream(placeholderSvg),
        )
    }

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
}
