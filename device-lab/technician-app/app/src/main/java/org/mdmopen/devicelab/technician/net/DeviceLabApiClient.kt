package org.mdmopen.devicelab.technician.net

import org.json.JSONObject
import org.mdmopen.devicelab.technician.protocol.DeviceEvidence
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * Plain HttpURLConnection client - no OkHttp/Retrofit dependency, since this sandbox cannot
 * verify a third-party dependency actually resolves and this app's needs (one POST endpoint)
 * do not justify the risk. Uses org.json (built into the Android platform, no extra
 * dependency) to build the request body in the exact shape POST /api/lab/scans already
 * expects from device-lab/scanner/scanner.js - see DeviceEvidence's own doc comment.
 */
class DeviceLabApiClient(private val baseUrl: String, private val auth: TechnicianAuth) {

    sealed class Result {
        data class Success(val scanId: String, val bodyJson: JSONObject) : Result()
        data class HttpError(val status: Int, val body: String) : Result()
        data class NetworkError(val message: String) : Result()
    }

    fun submitScan(evidence: DeviceEvidence): Result {
        val token = auth.getToken() ?: return Result.NetworkError("no technician token stored; log in first")
        return try {
            val url = URL("$baseUrl/api/lab/scans")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("content-type", "application/json")
                setRequestProperty("authorization", "Bearer $token")
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(toJson(evidence).toString()) }

            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.readText().orEmpty()
            conn.disconnect()

            if (status in 200..299) {
                val json = JSONObject(body)
                Result.Success(json.optString("id"), json)
            } else {
                Result.HttpError(status, body)
            }
        } catch (e: Exception) {
            Result.NetworkError(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun toJson(e: DeviceEvidence): JSONObject = JSONObject().apply {
        put("source", e.source)
        put("hostType", e.hostType)
        put("capturedAt", e.capturedAt)
        putOpt("adbSerial", e.adbSerial)
        putOpt("adbState", e.adbState)
        putOpt("setupWizardPackage", e.setupWizardPackage)
        putOpt("deviceOwner", e.deviceOwner)
        e.provisioningAllowed?.let { put("provisioningAllowed", it) }
        put("properties", JSONObject().apply {
            val p = e.properties
            putOpt("manufacturer", p.manufacturer); putOpt("brand", p.brand); putOpt("model", p.model)
            putOpt("product", p.product); putOpt("device", p.device); putOpt("board", p.board)
            putOpt("hardware", p.hardware); putOpt("platform", p.platform); putOpt("cpuAbi", p.cpuAbi)
            putOpt("androidVersion", p.androidVersion); putOpt("apiLevel", p.apiLevel)
            putOpt("buildFingerprint", p.buildFingerprint); putOpt("buildId", p.buildId)
            putOpt("buildIncremental", p.buildIncremental); putOpt("securityPatch", p.securityPatch)
            putOpt("bootloader", p.bootloader); putOpt("verifiedBootState", p.verifiedBootState)
            putOpt("flashLocked", p.flashLocked); putOpt("slotSuffix", p.slotSuffix)
            putOpt("dynamicPartitions", p.dynamicPartitions)
        })
        put("usb", JSONObject().apply {
            putOpt("vid", e.usb.vid); putOpt("pid", e.usb.pid); putOpt("mode", e.usb.mode); putOpt("raw", e.usb.raw)
        })
        put("fastboot", JSONObject().apply {
            putOpt("product", e.fastboot.product); putOpt("unlocked", e.fastboot.unlocked)
            putOpt("secure", e.fastboot.secure); putOpt("currentSlot", e.fastboot.currentSlot)
        })
    }
}
