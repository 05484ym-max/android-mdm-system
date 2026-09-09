package org.mdmopen.dpc

import android.content.Context

object PolicySync {

    const val TAG = "DpcSync"
    private val syncLock = Any()

    /**
     * A full cycle in one request: status out, policy and commands in. Status reaches
     * the server before any command runs, so a reboot or wipe cannot swallow it.
     *
     * All callers share one process-wide lock so manual, scheduled and push-triggered
     * syncs cannot apply policy/config changes concurrently.
     */
    fun run(context: Context): String = synchronized(syncLock) {
        val serverUrl = Config.serverUrl(context)
        require(serverUrl.isNotEmpty()) { "לא הוגדרה כתובת שרת" }

        val deviceToken = Config.deviceToken(context)
            ?: throw IllegalStateException("המכשיר אינו רשום — יש להזין קוד רישום")

        val deviceId = Config.deviceId(context)
        val enforcer = PolicyEnforcer(context)
        val api = ApiClient(serverUrl, deviceToken)

        val result = api.sync(
            deviceId,
            DeviceHealth.collect(context, enforcer.isDeviceOwner()),
        )

        // Universal target lookup is additive and guidance-only. A temporary
        // failure here must never break the established Device Owner sync path.
        runCatching {
            api.fetchProtectionTarget(deviceId)
        }.onSuccess { target ->
            RequestedProtectionStore.save(context, target)
        }

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

        // Successful manual, scheduled and push-triggered syncs all request an
        // immediate signed DPC update check. AutoUpdater is asynchronous and
        // internally guarded against concurrent runs.
        AutoUpdater.check(context.applicationContext)

        buildString {
            append("רקע: $wallpaperResult")
            append("\nמותרות ${result.policy.allowedApps.size} · ")
            append("הושעו ${enforcement.suspended.size} · ")
            append("שוחררו ${enforcement.unsuspended.size} · ")
            append("נכשלו ${enforcement.failed.size} · ")
            append("דולגו ${enforcement.systemAppsSkipped} מערכת · ")
            append("קיוסק ${if (enforcement.kioskEnabled) "פעיל" else "כבוי"} · ")
            append("סנכרון כל ${result.policy.syncIntervalMinutes} דק'")
            append("\n• WhatsApp Guard: $whatsappGuardResult")
            dnsReconcileResult?.let { append("\n• DNS: $it") }
            dnsFailSafeResult?.let { append("\n• $it") }
            outcomes.forEach { append("\n• $it") }
        }
    }
}
