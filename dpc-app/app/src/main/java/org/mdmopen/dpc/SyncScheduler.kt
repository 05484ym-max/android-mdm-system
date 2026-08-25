package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

object SyncScheduler {

    private const val JOB_ID = 1001

    /** JobScheduler clamps periodic jobs to a 15 minute minimum. */
    private const val MIN_INTERVAL_MINUTES = 15

    /** Reschedules the background sync to match the interval the server asked for. */
    fun schedule(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        val minutes = Config.syncIntervalMinutes(context).coerceAtLeast(MIN_INTERVAL_MINUTES)
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, SyncJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(minutes * 60_000L)
            .setPersisted(true)
            .build()
        scheduler.schedule(job)
    }
}
