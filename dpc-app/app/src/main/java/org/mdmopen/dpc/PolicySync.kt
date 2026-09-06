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
        WhatsAppGuardConfig.save(context, result.policy.whatsappGuard)
        Config.setDnsPolicy(
            context,
            result.dns.desiredProviderHost,
            result.dns.filteringRequested,
            result.dns.allowCustomerToggle,
            result.dns.desiredProviderFilters,
        )
        Config.setDnsPendingCustomerRequest(context, null)
        Config.setSubscriptionAccess(context, result.subscriptionAccess)

        val dnsReconcileResult = AdBlockDns.reconcile(context)
        val dnsFailSafeResult = AdBlockDns.runFailSafeCheckCycle(context)

        val enforcement = enforcer.apply(result.policy)
        val whatsappGuardResult = WhatsAppGuardProtection.reconcile(
            context,
            result.policy.whatsappGuard,
        )
        WhatsAppGuardWatchdogScheduler.reconcileSchedule(context)
        DeviceHealth.recordNoLauncherDryRun(context, enforcement.wouldHideNoLauncher)
        SyncScheduler.schedule(context)
        UpdateCheckScheduler.scheduleIfNeeded(context)
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

        // A successful manual or remote policy sync now also performs an immediate
        // self-update check. AutoUpdater runs on its own worker thread and has an
        // atomic guard, so this does not delay the sync UI and cannot race the
        // scheduled/push-triggered updater. Device Owner + signature verification
        // keep the update silent and restricted to our signed DPC package.
        AutoUpdater.check(context.applicationContext)

        return buildString {
            append("רקע: $wallpaperResult")
            append("\nמותרות ${result.policy.allowedApps.size} · ")
            append("הושעו ${enforcement.suspended.size} · ")
            append("שוחררו ${enforcement.unsuspended.size} · ")
            append("נכשלו ${enforcement.failed.size} · ")
            append("דולגו ${enforcement.systemAppsSkipped} מערכת · ")
            append("קיוסק ${if (enforcement.kioskEnabled) "פעיל" else "כבוי"} · ")
            append("סנכרון כל ${result.policy.syncIntervalMinutes} דק'")
            append("\n• WhatsApp Guard: $whatsappGuardResult")
            append("\n• בדיקת עדכון MDM הופעלה")
            dnsReconcileResult?.let { append("\n• DNS: $it") }
            dnsFailSafeResult?.let { append("\n• $it") }
            outcomes.forEach { append("\n• $it") }
        }
    }
}
