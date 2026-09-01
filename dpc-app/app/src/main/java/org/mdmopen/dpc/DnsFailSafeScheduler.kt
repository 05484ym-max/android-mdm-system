package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

/**
 * Schedules the local DNS fail-safe watchdog independently of the regular
 * policy sync interval (which can be configured up to 24h) - a rollback that
 * only gets checked once an hour is far too slow: at the default 60-minute
 * sync interval, CONSECUTIVE_FAILURES_TO_ROLLBACK (4) means up to ~4 hours
 * of broken DNS before the fail-safe ever fires.
 *
 * This runs its own JobScheduler periodic job at Android's own platform
 * minimum for periodic jobs - 15 minutes. That is not a cautious middle
 * ground, it is the fastest this mechanism can legally run: JobScheduler
 * silently clamps any shorter setPeriodic() value up to its own minimum
 * (see SyncScheduler's own comment on the same constant). Going faster would
 * mean an exact AlarmManager alarm or a foreground service - both
 * meaningfully more expensive and exactly the "aggressive polling" this was
 * asked not to do. At 15 minutes, worst-case detection drops from ~4 hours
 * to ~1 hour.
 *
 * Battery impact: AdBlockDns.runFailSafeCheckCycle() early-returns almost
 * immediately whenever DNS filtering isn't active and there's no incident in
 * progress - most firings across a fleet do nothing but a couple of cheap
 * local reads. When there genuinely is something to check, it's at most
 * three short socket probes, each bounded to a few seconds - comparable to
 * one page load, not a continuous drain. Like any JobScheduler periodic job,
 * real firings are batched into the OS's own Doze/App-Standby maintenance
 * windows rather than the exact requested minute, so cadence can run looser
 * than 15 minutes while the device sits idle - an accepted trade-off for not
 * fighting Doze with a wakelock or an exact alarm.
 */
object DnsFailSafeScheduler {

    private const val JOB_ID = 1002
    private const val INTERVAL_MS = 15 * 60_000L

    /** Called every sync (see PolicySync.run()) - only schedules the watchdog
     * for a device that has ever been given a DNS policy at all, and cancels
     * it again once that's no longer true, so a device that never touches
     * this feature never carries the extra periodic job. */
    fun scheduleIfNeeded(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (Config.dnsDesiredProviderHost(context) == null) {
            scheduler.cancel(JOB_ID)
            return
        }
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, DnsFailSafeJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(INTERVAL_MS)
            .setPersisted(true)
            .build()
        scheduler.schedule(job)
    }
}
