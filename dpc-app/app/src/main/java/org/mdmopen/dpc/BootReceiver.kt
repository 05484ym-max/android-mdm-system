package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        // Boot recovery is deliberately best-effort per subsystem. One OEM
        // exception must not prevent unrelated protections/schedulers from
        // recovering after reboot.
        safe("managed-install recovery") { ManagedInstallWindow.recoverIfNeeded(context) }

        if (Config.serverUrl(context).isEmpty()) return
        safe("policy sync schedule") { SyncScheduler.schedule(context) }
        safe("update schedule") { UpdateCheckScheduler.scheduleIfNeeded(context) }
        safe("DNS fail-safe schedule") { DnsFailSafeScheduler.scheduleIfNeeded(context) }
        safe("DNS immediate check") { DnsFailSafeScheduler.scheduleImmediateCheck(context) }
        safe("WhatsApp watchdog schedule") { WhatsAppGuardWatchdogScheduler.reconcileSchedule(context) }
        safe("WhatsApp immediate check") { WhatsAppGuardWatchdogScheduler.scheduleImmediateCheck(context) }
    }

    private inline fun safe(label: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, "Boot step failed: $label", e)
        }
    }

    companion object {
        private const val TAG = "MdmBootReceiver"
    }
}
