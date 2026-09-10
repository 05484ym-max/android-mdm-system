package org.mdmopen.dpc

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class FrpRemotePolicy(
    val enabled: Boolean,
    val accountIds: List<String>,
)

/**
 * Small FRP-only client kept separate from the legacy ApiClient so the FRP
 * rollout stays additive and easy to remove/disable independently.
 */
class FrpApiClient(
    private val baseUrl: String,
    private val deviceToken: String,
) {
    fun fetchPolicy(deviceId: String): FrpRemotePolicy {
        val body = request("GET", "/api/devices/${segment(deviceId)}/frp-policy", null)
        val json = JSONObject(body)
        val array = json.optJSONArray("accountIds") ?: JSONArray()
        val accounts = (0 until array.length())
            .mapNotNull { index -> array.optString(index, null)?.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
        return FrpRemotePolicy(
            enabled = json.optBoolean("enabled", false),
            accountIds = accounts,
        )
    }

    fun reportStatus(deviceId: String, status: FrpProtectionManager.Status) {
        val body = JSONObject()
            .put("apiSupported", status.apiSupported)
            .put("deviceOwner", status.deviceOwner)
            .put("policyReadable", status.policyReadable)
            .put("enabled", status.enabled ?: JSONObject.NULL)
            .put("accountCount", status.accountCount ?: JSONObject.NULL)
            .put("matchesDesired", status.matchesDesired ?: JSONObject.NULL)
            .put("error", status.error ?: JSONObject.NULL)
        request("POST", "/api/devices/${segment(deviceId)}/frp-status", body)
    }

    private fun segment(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun request(method: String, path: String, body: JSONObject?): String {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20_000
            readTimeout = 90_000
            setRequestProperty("Authorization", "Bearer $deviceToken")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use(BufferedReader::readText)
            }.orEmpty()
            if (code !in 200..299) throw ApiException("HTTP $code: ${text.take(200)}")
            return text
        } finally {
            connection.disconnect()
        }
    }
}
