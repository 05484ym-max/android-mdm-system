package org.mdmopen.dpc

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object ProtectionTargetClient {
    fun fetch(baseUrl: String, deviceId: String, deviceToken: String): RequestedProtectionTarget {
        val encodedId = URLEncoder.encode(deviceId, "UTF-8").replace("+", "%20")
        val conn = (URL("$baseUrl/api/devices/$encodedId/protection-target").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 20_000
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $deviceToken")
        }
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use(BufferedReader::readText)
            }.orEmpty()
            if (code !in 200..299) throw ApiException("HTTP $code: ${text.take(200)}")

            val json = JSONObject(text)
            return RequestedProtectionTarget(
                requestedProfile = json.optString("requestedProfile", "HARDENED_ADMIN"),
                achievedProfile = json.optString("achievedProfile", "BASIC"),
                protectionSatisfied = json.optBoolean("protectionSatisfied", false),
                missingCapabilities = json.optJSONArray("missingCapabilities")?.let { array ->
                    (0 until array.length()).mapNotNull { index -> array.optString(index, null) }
                } ?: emptyList(),
                nextActions = json.optJSONArray("nextActions")?.let { array ->
                    (0 until array.length()).mapNotNull { index -> array.optString(index, null) }
                } ?: emptyList(),
                requiresReprovisioning = json.optBoolean("requiresReprovisioning", false),
                requiresSystemIntegration = json.optBoolean("requiresSystemIntegration", false),
            )
        } finally {
            conn.disconnect()
        }
    }
}
