package org.yehudikasher.browser

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/** What Android ever gets back for a host/image/video classification
 * request. ERROR covers every failure mode (network error, timeout,
 * malformed response, non-2xx status) - callers must always treat ERROR
 * the same as BLOCK (see RemotePolicyGate/ImageFilterPolicy), never as a
 * silent ALLOW. */
enum class RemoteDecision {
    ALLOW,
    BLOCK,
    ERROR,
}

/**
 * The one seam between this app and server-side content classification.
 * The server (managed separately - see this feature's own scope) owns
 * every actual judgment call; Android never runs its own AI/vision
 * classification and never has an opinion of its own about a host or
 * image beyond enforcing whatever this interface returns. Each method is
 * a plain, synchronous, blocking call - RemotePolicyGate is what adds
 * bounded concurrency, caching, de-duplication and a timeout on top of it,
 * so implementations here don't need to worry about any of that.
 */
interface RemoteClassifier {
    fun classifyHost(host: String): RemoteDecision
    fun classifyImage(url: String): RemoteDecision

    /**
     * Not called from anywhere yet - see SecureWebViewClient. Exists only
     * so a future video-moderation feature has a stable, already-shaped
     * entry point (and a real HTTP implementation already wired below) to
     * build on, per this task's explicit instruction not to add video
     * moderation enforcement yet.
     */
    fun classifyVideo(url: String): RemoteDecision
}

/**
 * Real HTTP implementation. The exact endpoint path/request/response
 * shape below is a placeholder this Android-side change had to assume,
 * since the classification backend is owned and versioned separately
 * (see this feature's own scope, "don't change the server-side
 * classification mechanism") - whoever wires the real service should
 * either match this contract or swap this class out; every caller in this
 * app only ever depends on the RemoteClassifier interface, never on this
 * class directly, so that swap needs no other change.
 *
 * Request:  POST {baseUrl}{path}  {"kind":"HOST"|"IMAGE"|"VIDEO","value":"<host-or-url>"}
 * Response: 200 {"decision":"ALLOW"|"BLOCK"}  - anything else (non-2xx,
 *           malformed body, unexpected decision string, network failure)
 *           is treated as ERROR, never as ALLOW.
 */
class HttpRemoteClassifier(
    private val baseUrl: String,
    private val connectTimeoutMs: Int = 5_000,
    private val readTimeoutMs: Int = 5_000,
) : RemoteClassifier {

    override fun classifyHost(host: String): RemoteDecision = classify("HOST", host)
    override fun classifyImage(url: String): RemoteDecision = classify("IMAGE", url)
    override fun classifyVideo(url: String): RemoteDecision = classify("VIDEO", url)

    private fun classify(kind: String, value: String): RemoteDecision {
        return try {
            val url = URL("$baseUrl/api/browser-filter/classify")
            require(url.protocol == "https") { "classification endpoint must be https" }

            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = connectTimeoutMs
                readTimeout = readTimeoutMs
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            val body = JSONObject().put("kind", kind).put("value", value).toString()
            connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }

            if (connection.responseCode !in 200..299) {
                return RemoteDecision.ERROR
            }
            val responseText = connection.inputStream.use { it.reader(StandardCharsets.UTF_8).readText() }
            when (JSONObject(responseText).optString("decision", "")) {
                "ALLOW" -> RemoteDecision.ALLOW
                "BLOCK" -> RemoteDecision.BLOCK
                else -> RemoteDecision.ERROR
            }
        } catch (_: Exception) {
            RemoteDecision.ERROR
        }
    }
}
