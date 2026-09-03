package org.mdmopen.dpc

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (Config.serverUrl(context).isEmpty()) return
        SyncScheduler.schedule(context)
        DnsFailSafeScheduler.scheduleIfNeeded(context)
        DnsFailSafeScheduler.scheduleImmediateCheck(context)
    }
}
