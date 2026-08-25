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
    val syncIntervalMinutes: Int,
)

data class QueuedCommand(
    val command: String,
    val params: JSONObject,
)

data class SyncResult(
    val policy: Policy,
    val commands: List<QueuedCommand>,
)

class ApiException(message: String) : Exception(message)

class ApiClient(
    private val baseUrl: String,
    private val deviceToken: String? = null,
) {

    /** One-time enrollment. Returns the long-lived device token to store. */
    fun enroll(deviceId: String, enrollmentToken: String): String {
        val body = request(
            "POST",
            "/api/devices/register",
            JSONObject()
                .put("deviceId", deviceId)
                .put("enrollmentToken", enrollmentToken),
        )
        return JSONObject(body).getString("deviceToken")
    }

    /**
     * A whole sync cycle in one round trip: reports status, returns the policy and
     * any queued commands. The server marks those commands delivered.
     */
    fun sync(deviceId: String, status: JSONObject): SyncResult {
        val body = request("POST", "/api/devices/${segment(deviceId)}/sync", status)
        val json = JSONObject(body)

        val policyJson = json.getJSONObject("policy")
        val apps = policyJson.optJSONArray("allowedApps") ?: JSONArray()
        val policy = Policy(
            allowedApps = (0 until apps.length()).map { apps.getString(it) },
            kioskEnabled = policyJson.optBoolean("kioskEnabled", false),
            syncIntervalMinutes = policyJson.optInt(
                "syncIntervalMinutes",
                Config.DEFAULT_SYNC_MINUTES,
            ),
        )

        val queued = json.optJSONArray("commands") ?: JSONArray()
        val commands = (0 until queued.length()).map { index ->
            val item = queued.getJSONObject(index)
            QueuedCommand(
                command = item.getString("command"),
                params = item.optJSONObject("params") ?: JSONObject(),
            )
        }

        return SyncResult(policy, commands)
    }

    private fun segment(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun request(method: String, path: String, body: JSONObject?): String {
        val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            // A sleeping free-tier instance can take close to a minute to wake up.
            connectTimeout = 20_000
            readTimeout = 90_000
            deviceToken?.let { setRequestProperty("Authorization", "Bearer $it") }
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
