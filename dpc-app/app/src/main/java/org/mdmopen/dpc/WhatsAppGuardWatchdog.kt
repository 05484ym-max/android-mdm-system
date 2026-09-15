package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Periodic backstop for the WhatsApp accessibility dependency.
 *
 * The guard is deliberately fail-open if Accessibility is lost, and Samsung's
 * accessibility settings are hidden after successful setup. That makes a
 * 15-minute wakeup unnecessarily aggressive. Normal policy sync, boot handling,
 * service connection and an immediate boot check still reconcile the state; the
 * periodic backstop can safely run hourly and let Android batch it in Doze.
 */
class WhatsAppGuardWatchdogJobService : JobService() {
    override fun onStartJob(params: JobParameters?): Boolean {
        WhatsAppGuardProtection.reconcile(this, WhatsAppGuardConfig.load(this))
        jobFinished(params, false)
        return false
    }

    override fun onStopJob(params: JobParameters?): Boolean = false
}

object WhatsAppGuardWatchdogScheduler {
    private const val JOB_ID = 0x574147 // "WAG"
    private const val PERIOD_MS = 60 * 60 * 1000L

    fun reconcileSchedule(context: Context) {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (!WhatsAppGuardConfig.load(context).enabled) {
            scheduler.cancel(JOB_ID)
            scheduler.cancel(JOB_ID + 1)
            return
        }

        // Do not replace an identical persisted job every time PolicySync runs.
        if (scheduler.getPendingJob(JOB_ID) != null) return

        val component = ComponentName(context, WhatsAppGuardWatchdogJobService::class.java)
        val info = JobInfo.Builder(JOB_ID, component)
            .setPersisted(true)
            .setPeriodic(PERIOD_MS)
            .build()
        scheduler.schedule(info)
    }

    fun scheduleImmediateCheck(context: Context) {
        if (!WhatsAppGuardConfig.load(context).enabled) return
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        val component = ComponentName(context, WhatsAppGuardWatchdogJobService::class.java)
        val immediateId = JOB_ID + 1
        scheduler.schedule(
            JobInfo.Builder(immediateId, component)
                .setMinimumLatency(1_000L)
                .setOverrideDeadline(5_000L)
                .build()
        )
    }
}
