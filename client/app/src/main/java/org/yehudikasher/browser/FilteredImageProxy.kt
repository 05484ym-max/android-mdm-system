package org.yehudikasher.browser

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class FilteredImageProxy(
    private val baseUrl: String = BuildConfig.FILTER_API_BASE_URL,
) {
    fun shouldProxy(request: WebResourceRequest?): Boolean {
        if (request == null || request.isForMainFrame) return false
        if (!request.method.equals("GET", ignoreCase = true)) return false

        val accept = request.requestHeaders.entries
            .firstOrNull { it.key.equals("Accept", ignoreCase = true) }
            ?.value
            .orEmpty()
            .lowercase()

        if (accept.contains("image/")) return true

        val path = request.url.path.orEmpty().lowercase()
        return IMAGE_EXTENSIONS.any(path::endsWith)
    }

    fun fetch(rawUrl: String): WebResourceResponse {
        val conn = try {
            (URL(baseUrl.trimEnd('/') + "/api/browser/image").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 7_000
                readTimeout = 20_000
                doOutput = true
                instanceFollowRedirects = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "image/png,image/jpeg,image/webp,image/svg+xml")
                setRequestProperty("User-Agent", "YehudiKasherFilteredBrowser/1")
            }
        } catch (_: Exception) {
            return BlockedResponse.imagePlaceholder()
        }

        return try {
            val body = JSONObject().put("url", rawUrl).toString().toByteArray(Charsets.UTF_8)
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }

            if (conn.responseCode !in 200..299) {
                return BlockedResponse.imagePlaceholder()
            }

            val contentType = conn.contentType
                ?.substringBefore(';')
                ?.trim()
                ?.lowercase()
                .orEmpty()

            if (contentType !in ALLOWED_RESPONSE_TYPES) {
                return BlockedResponse.imagePlaceholder()
            }

            val bytes = readBounded(conn.inputStream, MAX_PROXY_RESPONSE_BYTES)
                ?: return BlockedResponse.imagePlaceholder()

            WebResourceResponse(
                contentType,
                null,
                200,
                "OK",
                mapOf(
                    "Cache-Control" to "private, max-age=300",
                    "X-Content-Type-Options" to "nosniff",
                ),
                ByteArrayInputStream(bytes),
            )
        } catch (_: Exception) {
            BlockedResponse.imagePlaceholder()
        } finally {
            conn.disconnect()
        }
    }

    private fun readBounded(
        input: java.io.InputStream,
        maxBytes: Int,
    ): ByteArray? {
        input.use { stream ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > maxBytes) return null
                out.write(buffer, 0, read)
            }
            return out.toByteArray()
        }
    }

    companion object {
        private const val MAX_PROXY_RESPONSE_BYTES = 6 * 1024 * 1024

        private val IMAGE_EXTENSIONS = setOf(
            ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico", ".svg", ".avif"
        )

        private val ALLOWED_RESPONSE_TYPES = setOf(
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/svg+xml",
        )
    }
}
