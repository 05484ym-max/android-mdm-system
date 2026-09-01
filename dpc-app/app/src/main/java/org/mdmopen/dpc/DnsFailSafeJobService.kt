package org.mdmopen.dpc

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

/** Fires on DnsFailSafeScheduler's own 15-minute cadence, independent of the
 * regular sync job - see that scheduler's doc for why. Never talks to the
 * backend (AdBlockDns.runFailSafeCheckCycle() is entirely local), so this
 * keeps working even when the very thing being checked (DNS) is broken. */
class DnsFailSafeJobService : JobService() {

    @Volatile
    private var stopped = false

    override fun onStartJob(params: JobParameters?): Boolean {
        stopped = false
        Thread {
            try {
                AdBlockDns.runFailSafeCheckCycle(applicationContext)
                    ?.let { Log.i(PolicySync.TAG, "DNS fail-safe watchdog: $it") }
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "DNS fail-safe watchdog failed", e)
            } finally {
                if (!stopped) jobFinished(params, false)
            }
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        stopped = true
        return true
    }
}
