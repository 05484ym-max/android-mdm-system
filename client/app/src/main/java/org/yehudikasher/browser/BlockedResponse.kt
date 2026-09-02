package org.yehudikasher.browser

import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

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
}
