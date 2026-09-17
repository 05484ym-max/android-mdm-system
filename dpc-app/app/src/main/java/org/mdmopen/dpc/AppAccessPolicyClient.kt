package org.mdmopen.dpc

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class RemoteAppAccessPolicy(
    val mode: AppAccessMode,
    val blockedApps: Set<String>,
)

class AppAccessPolicyClient(
    private val baseUrl: String,
    private val deviceToken: String,
) {
    fun fetch(deviceId: String): RemoteAppAccessPolicy {
        val encodedId = URLEncoder.encode(deviceId, "UTF-8").replace("+", "%20")
        val connection = URL("${baseUrl.trimEnd('/')}/api/devices/$encodedId/app-access-policy")
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 20_000
            connection.readTimeout = 90_000
            connection.setRequestProperty("Authorization", "Bearer $deviceToken")
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use(BufferedReader::readText)
            }.orEmpty()
            if (code !in 200..299) throw ApiException("HTTP $code: ${text.take(500)}")

            val json = JSONObject(text)
            val mode = when (json.optString("mode")) {
                AppAccessMode.OPEN_WITH_BLACKLIST.name -> AppAccessMode.OPEN_WITH_BLACKLIST
                else -> AppAccessMode.APPROVED_ONLY
            }
            val array = json.optJSONArray("blockedApps")
            val blockedApps = if (array == null) emptySet() else
                (0 until array.length()).mapNotNull { index -> array.optString(index, null) }
                    .filter { it.isNotBlank() }
                    .toSet()
            return RemoteAppAccessPolicy(mode, blockedApps)
        } finally {
            connection.disconnect()
        }
    }
}
