package org.mdmopen.dpc

import android.content.Context
import android.os.Build
import org.json.JSONObject

object PolicySync {

    const val TAG = "DpcSync"

    /**
     * Registers, pulls and enforces the policy, reports status, then runs any queued
     * commands. Status is reported before commands so a reboot or wipe cannot swallow it.
     */
    fun run(context: Context): String {
        val serverUrl = Config.serverUrl(context)
        require(serverUrl.isNotEmpty()) { "Server URL is not configured" }

        val deviceId = Config.deviceId(context)
        val api = ApiClient(serverUrl)
        api.register(deviceId)

        val policy = api.fetchPolicy(deviceId)
        Config.setAllowedApps(context, policy.allowedApps)
        Config.setKioskEnabled(context, policy.kioskEnabled)

        val enforcer = PolicyEnforcer(context)
        val result = enforcer.apply(policy)

        api.sendHeartbeat(
            deviceId,
            JSONObject()
                .put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                .put("androidVersion", Build.VERSION.RELEASE)
                .put("isDeviceOwner", enforcer.isDeviceOwner()),
        )

        val outcomes = runQueuedCommands(context, api, deviceId)

        return buildString {
            append("מותרות ${policy.allowedApps.size} · הושעו ${result.suspended.size} · ")
            append("שוחררו ${result.unsuspended.size} · נכשלו ${result.failed.size} · ")
            append("דולגו ${result.systemAppsSkipped} מערכת · ")
            append("קיוסק ${if (result.kioskEnabled) "פעיל" else "כבוי"}")
            outcomes.forEach { append("\n• $it") }
        }
    }

    private fun runQueuedCommands(
        context: Context,
        api: ApiClient,
        deviceId: String,
    ): List<String> {
        val executor = CommandExecutor(context)
        return api.fetchCommands(deviceId).map { command ->
            try {
                executor.execute(command)
            } catch (e: Exception) {
                "פקודה $command נכשלה: ${e.message}"
            }
        }
    }
}
