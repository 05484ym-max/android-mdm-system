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
        Config.setDnsPolicy(
            context,
            result.dns.desiredProviderHost,
            result.dns.filteringRequested,
            result.dns.allowCustomerToggle,
            result.dns.desiredProviderFilters,
        )
        // Whatever pending customer request was included in this sync's health
        // payload (see DeviceHealth.collect()) has now been seen and answered
        // by the server either way (honored or not, e.g. permission revoked in
        // the meantime) - result.dns above already reflects the outcome, so
        // there is nothing left to retry.
        Config.setDnsPendingCustomerRequest(context, null)
        Config.setSubscriptionAccess(context, result.subscriptionAccess)

        // Server-desired DNS state applied first (mirrors PolicyEnforcer.apply()
        // below for apps), then the fully-local fail-safe watchdog runs - see
        // AdBlockDns.reconcile()'s own comment for why a rollback in progress
        // isn't immediately undone by this reconcile call.
        val dnsReconcileResult = AdBlockDns.reconcile(context)
        val dnsFailSafeResult = AdBlockDns.runFailSafeCheckCycle(context)

        val enforcement = enforcer.apply(result.policy)
        // Reported on the *next* sync's health payload, same lag as
        // recordUpdateResult() - see DeviceHealth.recordNoLauncherDryRun().
        DeviceHealth.recordNoLauncherDryRun(context, enforcement.wouldHideNoLauncher)
        SyncScheduler.schedule(context)
        // MDM self-update checks are intentionally independent of policy sync:
        // every ~6h with fresh 0-60m jitter, so a large fleet cannot stampede
        // version.json / APK downloads at the same moment.
        UpdateCheckScheduler.scheduleIfNeeded(context)
        // Independent of the sync interval on purpose - see
        // DnsFailSafeScheduler's own doc for cadence/battery reasoning.
        DnsFailSafeScheduler.scheduleIfNeeded(context)
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
            // Put wallpaper diagnostics first so the long customer sync Toast
            // doesn't hide the only signal we need while diagnosing Samsung.
            append("רקע: $wallpaperResult")
            append("\nמותרות ${result.policy.allowedApps.size} · ")
            append("הושעו ${enforcement.suspended.size} · ")
            append("שוחררו ${enforcement.unsuspended.size} · ")
            append("נכשלו ${enforcement.failed.size} · ")
            append("דולגו ${enforcement.systemAppsSkipped} מערכת · ")
            append("קיוסק ${if (enforcement.kioskEnabled) "פעיל" else "כבוי"} · ")
            append("סנכרון כל ${result.policy.syncIntervalMinutes} דק'")
            dnsReconcileResult?.let { append("\n• DNS: $it") }
            dnsFailSafeResult?.let { append("\n• $it") }
            outcomes.forEach { append("\n• $it") }
        }
    }
}
