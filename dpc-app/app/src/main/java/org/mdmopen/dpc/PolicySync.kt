package org.mdmopen.dpc

import android.content.Context
import android.os.Build
import org.json.JSONObject

object PolicySync {

    const val TAG = "DpcSync"

    /** Registers, pulls the policy, enforces it and reports status. Throws on failure. */
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

        return "מותרות ${policy.allowedApps.size} · הושעו ${result.suspended.size} · " +
            "שוחררו ${result.unsuspended.size} · נכשלו ${result.failed.size} · " +
            "דולגו ${result.systemAppsSkipped} מערכת · " +
            "קיוסק ${if (result.kioskEnabled) "פעיל" else "כבוי"}"
    }
}
