package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        // Anti-reset/anti-escape policy is local Device Owner state and must be
        // restored immediately after boot, before any network-dependent sync.
        ResetProtection.enforce(context)
        AutoUpdater.recoverInstallBlockIfNeeded(context)

        if (Config.serverUrl(context).isEmpty()) return
        SyncScheduler.schedule(context)
        UpdateCheckScheduler.scheduleIfNeeded(context)
        DnsFailSafeScheduler.scheduleIfNeeded(context)
        DnsFailSafeScheduler.scheduleImmediateCheck(context)
        WhatsAppGuardWatchdogScheduler.reconcileSchedule(context)
        WhatsAppGuardWatchdogScheduler.scheduleImmediateCheck(context)
    }
}
