package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

/**
 * Schedules the local DNS fail-safe watchdog independently of regular policy sync.
 * The 15-minute cadence is kept only while strict DNS filtering is actually
 * requested; once filtering is off, the watchdog is cancelled instead of waking
 * forever merely because a provider hostname remains cached.
 */
object DnsFailSafeScheduler {

    private const val PERIODIC_JOB_ID = 1002
    // Deliberately distinct from UpdateCheckScheduler.JOB_ID (1003). A previous
    // collision could replace the scheduled updater job after boot.
    private const val IMMEDIATE_JOB_ID = 1004
    private const val INTERVAL_MS = 15 * 60_000L

    /** One-shot check used after boot when filtering is active. */
    fun scheduleImmediateCheck(context: Context) {
        if (!Config.dnsFilteringRequested(context)) return
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val job = JobInfo.Builder(
            IMMEDIATE_JOB_ID,
            ComponentName(context, DnsFailSafeJobService::class.java)
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(0)
            .setOverrideDeadline(30_000L)
            .build()
        scheduler.schedule(job)
    }

    fun scheduleIfNeeded(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (!Config.dnsFilteringRequested(context)) {
            scheduler.cancel(PERIODIC_JOB_ID)
            scheduler.cancel(IMMEDIATE_JOB_ID)
            return
        }

        // Avoid replacing an identical periodic job on every policy sync.
        if (scheduler.getPendingJob(PERIODIC_JOB_ID) != null) return

        val job = JobInfo.Builder(
            PERIODIC_JOB_ID,
            ComponentName(context, DnsFailSafeJobService::class.java)
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(INTERVAL_MS)
            .setPersisted(true)
            .build()
        scheduler.schedule(job)
    }
}
