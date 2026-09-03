package org.mdmopen.dpc

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

class UpdateCheckJobService : JobService() {

    @Volatile
    private var stopped = false

    override fun onStartJob(params: JobParameters?): Boolean {
        stopped = false

        Thread {
            try {
                AutoUpdater.checkBlocking(applicationContext)
            } catch (e: Exception) {
                Log.w(TAG, "Scheduled update check failed", e)
            } finally {
                if (!stopped) {
                    jobFinished(params, false)
                    UpdateCheckScheduler.scheduleNext(applicationContext)
                }
            }
        }.start()

        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        stopped = true
        // Let JobScheduler retry this interrupted run. We deliberately do not
        // schedule a second job here, avoiding duplicate update checks.
        return true
    }

    companion object {
        private const val TAG = "MdmAutoUpdater"
    }
}
