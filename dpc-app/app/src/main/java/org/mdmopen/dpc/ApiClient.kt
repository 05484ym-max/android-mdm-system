package org.mdmopen.dpc

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class Policy(
    val allowedApps: List<String>,
    val kioskEnabled: Boolean,
)

class ApiException(message: String) : Exception(message)

class ApiClient(private val baseUrl: String) {

    fun register(deviceId: String) {
        request("POST", "/api/devices/register", JSONObject().put("deviceId", deviceId))
    }

    fun fetchPolicy(deviceId: String): Policy {
        val body = request("GET", "/api/devices/${segment(deviceId)}/policy", null)
        val json = JSONObject(body)
        val apps = json.optJSONArray("allowedApps") ?: JSONArray()
        return Policy(
            allowedApps = (0 until apps.length()).map { apps.getString(it) },
            kioskEnabled = json.optBoolean("kioskEnabled", false),
        )
    }

    /** Pulls the queued commands. The server treats them as delivered once fetched. */
    fun fetchCommands(deviceId: String): List<String> {
        val body = request("GET", "/api/devices/${segment(deviceId)}/commands", null)
        val queued = JSONObject(body).optJSONArray("commands") ?: JSONArray()
        return (0 until queued.length()).map { queued.getJSONObject(it).getString("command") }
    }

    fun sendHeartbeat(deviceId: String, status: JSONObject) {
        request("POST", "/api/devices/${segment(deviceId)}/heartbeat", status)
    }

    private fun segment(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun request(method: String, path: String, body: JSONObject?): String {
        val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8)
                    .use { it.write(body.toString()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use(BufferedReader::readText)
            }.orEmpty()
            if (code !in 200..299) {
                throw ApiException("HTTP $code: ${text.take(200)}")
            }
            return text
        } finally {
            conn.disconnect()
        }
    }
}
