package org.mdmopen.dpc

import android.content.Context
import android.provider.Settings
import android.util.Log
import java.util.UUID

object PolicySync {

    const val TAG = "DpcSync"
    private const val PACKAGE_ATTEMPT_TIMEOUT_MS = 20L * 60L * 1000L
    private val syncLock = Any()
    private val commandLock = Any()
    private val asyncPackageCommands = setOf("INSTALL_APP", "UNINSTALL_APP")

    private data class PreparedSync(
        val api: ApiClient,
        val deviceId: String,
        val commands: List<QueuedCommand>,
        val summary: String,
    )

    fun run(context: Context): String {
        val prepared = synchronized(syncLock) {
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

            runCatching { api.fetchProtectionTarget(deviceId) }
                .onSuccess { RequestedProtectionStore.save(context, it) }

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
            ManagedInstallWindow.setDesiredInstallBlocked(context, !result.policy.fullOpen)

            val dnsReconcileResult = AdBlockDns.reconcile(context)
            val dnsFailSafeResult = AdBlockDns.runFailSafeCheckCycle(context)
            val enforcement = enforcer.apply(result.policy)
            val whatsappGuardResult = WhatsAppGuardProtection.reconcile(context, result.policy.whatsappGuard)
            WhatsAppGuardWatchdogScheduler.reconcileSchedule(context)
            DeviceHealth.recordNoLauncherDryRun(context, enforcement.wouldHideNoLauncher)
            SyncScheduler.schedule(context)
            UpdateCheckScheduler.scheduleIfNeeded(context)
            DnsFailSafeScheduler.scheduleIfNeeded(context)
            PushRegistration.ensureRegistered(context)
            val wallpaperResult = WallpaperBranding.apply(context)

            val summary = buildString {
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
            }

            PreparedSync(api, deviceId, result.commands, summary)
        }

        val outcomes = synchronized(commandLock) {
            val executor = CommandExecutor(context)
            prepared.commands.map { queued ->
                executeCommandIdempotently(context, prepared.api, prepared.deviceId, executor, queued)
            }
        }

        return buildString {
            append(prepared.summary)
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
            when (queued.command) {
                "REBOOT" -> {
                    val beforeBoot = previous.metadata
                        ?.takeIf { it.startsWith("boot:") }
                        ?.removePrefix("boot:")
                        ?.toIntOrNull()
                    val nowBoot = bootCount(context)
                    if (beforeBoot != null && nowBoot > beforeBoot) {
                        val message = "אתחול המכשיר אומת לאחר הפקודה"
                        CommandJournal.markTerminal(context, queued.id, "SUCCESS", message)
                        safeReport(api, deviceId, queued.id, "SUCCESS", message)
                        return message
                    }
                }
                "WIPE" -> Unit
                "RELEASE_DEVICE_OWNER" -> {
                    if (!PolicyEnforcer(context).isDeviceOwner()) {
                        val message = "הסרת Device Owner אומתה לאחר הפקודה"
                        CommandJournal.markTerminal(context, queued.id, "SUCCESS", message)
                        safeReport(api, deviceId, queued.id, "SUCCESS", message)
                        return message
                    }
                }
                else -> if (queued.command in asyncPackageCommands) {
                    val startedAt = previous.startedAt ?: 0L
                    if (startedAt > 0L && System.currentTimeMillis() - startedAt < PACKAGE_ATTEMPT_TIMEOUT_MS) {
                        return "פקודה ${queued.command} עדיין ממתינה ל-callback של Android"
                    }
                    // The previous attempt is stale. Start a new generation;
                    // callbacks from the old generation are ignored by the receiver.
                }
            }
        }

        val packageAttemptId = if (queued.command in asyncPackageCommands) UUID.randomUUID().toString() else null
        val startMetadata = when {
            queued.command == "REBOOT" -> "boot:${bootCount(context)}"
            packageAttemptId != null -> "package:$packageAttemptId"
            else -> null
        }
        CommandJournal.markStarted(context, queued.id, startMetadata)

        return try {
            val message = executor.execute(queued, packageAttemptId)
            if (queued.command in asyncPackageCommands) {
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

    private fun bootCount(context: Context): Int =
        runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }
            .getOrDefault(-1)

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
