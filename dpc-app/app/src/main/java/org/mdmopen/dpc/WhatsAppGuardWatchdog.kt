package org.mdmopen.dpc

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Periodically re-checks the one runtime dependency the WhatsApp guard cannot
 * enable by itself: its AccessibilityService. If the service is switched off,
 * the next watchdog pass suspends WhatsApp instead of leaving it unfiltered.
 *
 * Android's minimum periodic JobScheduler cadence is roughly 15 minutes, so
 * this is a backstop in addition to normal sync, boot handling and the
 * AccessibilityService's own onServiceConnected reconciliation. It is not
 * described as instantaneous tamper detection.
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
    private const val PERIOD_MS = 15 * 60 * 1000L

    fun reconcileSchedule(context: Context) {
        val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
        if (!WhatsAppGuardConfig.load(context).enabled) {
            scheduler.cancel(JOB_ID)
            return
        }

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
