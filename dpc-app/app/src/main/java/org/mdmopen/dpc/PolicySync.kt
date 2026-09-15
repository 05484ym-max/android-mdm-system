package org.mdmopen.dpc

import android.content.Context
import android.util.Log

object PolicySync {

    const val TAG = "DpcSync"
    private val syncLock = Any()
    private val asyncPackageCommands = setOf("INSTALL_APP", "UNINSTALL_APP")
    private val irreversibleCommands = setOf("REBOOT", "WIPE", "RELEASE_DEVICE_OWNER")

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
        Config.setCustomerName(context, result.policy.customerName)
        Config.setCustomerNumber(context, result.policy.customerNumber)
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

        // Record the server-authoritative post-lease state before policy/apply or
        // any async installer callback can run. Every temporary install path now
        // returns to this desired state instead of blindly re-blocking installs.
        ManagedInstallWindow.setDesiredInstallBlocked(context, !result.policy.fullOpen)

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
            executeCommandIdempotently(context, api, deviceId, executor, queued)
        }

        // Update checks have their own 6-7 hour persisted JobScheduler cadence.
        // Do not open a second network connection on every normal policy sync.
        // An explicit admin retry-update still bypasses this path in PolicySyncWorker.

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

    private fun executeCommandIdempotently(
        context: Context,
        api: ApiClient,
        deviceId: String,
        executor: CommandExecutor,
        queued: QueuedCommand,
    ): String {
        val previous = CommandJournal.get(context, queued.id)
        if (previous?.terminal == true) {
            safeReport(api, deviceId, queued.id, previous.status, previous.message)
            return "פקודה ${queued.command} כבר הושלמה בעבר (${previous.status})"
        }

        if (previous?.status == "STARTED") {
            // Never repeat a potentially destructive/non-idempotent side effect
            // merely because its acknowledgement was lost.
            if (queued.command in irreversibleCommands) {
                val message = "הפקודה התקבלה והופעלה לפני אתחול/הפסקת התהליך"
                CommandJournal.markTerminal(context, queued.id, "SUCCESS", message)
                safeReport(api, deviceId, queued.id, "SUCCESS", message)
                return "$message (${queued.command})"
            }
            if (queued.command in asyncPackageCommands) {
                val message = "לא התקבל callback סופי מהפעלת החבילה הקודמת; לא בוצעה הפעלה כפולה"
                CommandJournal.markTerminal(context, queued.id, "FAILED", message)
                safeReport(api, deviceId, queued.id, "FAILED", message)
                return "פקודה ${queued.command} נעצרה ללא תוצאה סופית"
            }
            // The remaining commands are idempotent policy/state operations and
            // may safely be retried after an interrupted process.
        }

        CommandJournal.markStarted(context, queued.id)
        return try {
            val message = executor.execute(queued)
            if (queued.command in asyncPackageCommands) {
                // PackageInstaller owns the terminal result. Its receiver writes
                // the journal and reports SUCCESS/FAILED when Android finishes.
                message
            } else {
                CommandJournal.markTerminal(context, queued.id, "SUCCESS", message)
                safeReport(api, deviceId, queued.id, "SUCCESS", message)
                message
            }
        } catch (e: Exception) {
            val message = e.message ?: "פקודה ${queued.command} נכשלה"
            CommandJournal.markTerminal(context, queued.id, "FAILED", message)
            safeReport(api, deviceId, queued.id, "FAILED", message)
            "פקודה ${queued.command} נכשלה: $message"
        }
    }

    private fun safeReport(
        api: ApiClient,
        deviceId: String,
        commandId: String,
        status: String,
        message: String?,
    ) {
        try {
            api.reportCommandResult(deviceId, commandId, status, message)
        } catch (e: Exception) {
            Log.w(TAG, "Command result report failed; leased redelivery will retry", e)
        }
    }
}
