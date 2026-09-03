package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import kotlin.random.Random

object UpdateCheckScheduler {

    private const val JOB_ID = 1003
    private const val BASE_INTERVAL_MS = 6L * 60L * 60L * 1000L
    private const val JITTER_MAX_MS = 60L * 60L * 1000L
    private const val DEADLINE_SLACK_MS = 15L * 60L * 1000L

    /**
     * Keeps update checks fleet-friendly: one check roughly every 6 hours,
     * with a different 0-60 minute delay per device/check so thousands of
     * devices do not hit version.json or the APK at the same instant.
     *
     * This is intentionally a one-shot persisted job rather than a periodic
     * job: after each run we choose fresh jitter for the next run.
     */
    fun scheduleIfNeeded(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (scheduler.getPendingJob(JOB_ID) != null) return
        scheduleNext(context)
    }

    fun scheduleNext(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val jitter = Random.nextLong(JITTER_MAX_MS + 1L)
        val delay = BASE_INTERVAL_MS + jitter

        val job = JobInfo.Builder(
            JOB_ID,
            ComponentName(context, UpdateCheckJobService::class.java),
        )
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(delay)
            .setOverrideDeadline(delay + DEADLINE_SLACK_MS)
            .setPersisted(true)
            .build()

        scheduler.schedule(job)
    }
}
