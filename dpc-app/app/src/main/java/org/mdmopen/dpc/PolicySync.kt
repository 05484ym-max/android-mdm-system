package org.mdmopen.dpc

import android.content.Context

object PolicySync {

    const val TAG = "DpcSync"

    /**
     * A full cycle in one request: status out, policy and commands in. Status reaches
     * the server before any command runs, so a reboot or wipe cannot swallow it.
     */
    fun run(context: Context): String {
        val serverUrl = Config.serverUrl(context)
        require(serverUrl.isNotEmpty()) { "לא הוגדרה כתובת שרת" }

        val deviceToken = Config.deviceToken(context)
            ?: throw IllegalStateException("המכשיר אינו רשום — יש להזין קוד רישום")

        val deviceId = Config.deviceId(context)
        val enforcer = PolicyEnforcer(context)

        val result = ApiClient(serverUrl, deviceToken).sync(
            deviceId,
            DeviceHealth.collect(context, enforcer.isDeviceOwner()),
        )

        Config.setAllowedApps(context, result.policy.allowedApps)
        Config.setAppCatalog(context, result.catalog)
        Config.setKioskEnabled(context, result.policy.kioskEnabled)
        Config.setSyncIntervalMinutes(context, result.policy.syncIntervalMinutes)

        val enforcement = enforcer.apply(result.policy)
        SyncScheduler.schedule(context)
        PushRegistration.ensureRegistered(context)
        val wallpaperResult = WallpaperBranding.apply(context)

        val executor = CommandExecutor(context)
        val outcomes = result.commands.map { queued ->
            try {
                executor.execute(queued)
            } catch (e: Exception) {
                "פקודה ${queued.command} נכשלה: ${e.message}"
            }
        }

        return buildString {
            append("מותרות ${result.policy.allowedApps.size} · ")
            append("הושעו ${enforcement.suspended.size} · ")
            append("שוחררו ${enforcement.unsuspended.size} · ")
            append("נכשלו ${enforcement.failed.size} · ")
            append("דולגו ${enforcement.systemAppsSkipped} מערכת · ")
            append("קיוסק ${if (enforcement.kioskEnabled) "פעיל" else "כבוי"} · ")
            append("סנכרון כל ${result.policy.syncIntervalMinutes} דק' · ")
            append("רקע: $wallpaperResult")
            outcomes.forEach { append("\n• $it") }
        }
    }
}
