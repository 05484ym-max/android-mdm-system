package org.mdmopen.dpc

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

class SyncJobService : JobService() {

    @Volatile
    private var stopped = false

    override fun onStartJob(params: JobParameters?): Boolean {
        stopped = false
        Thread {
            var needsReschedule = false
            try {
                Log.i(PolicySync.TAG, "Scheduled sync: ${PolicySync.run(applicationContext)}")
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "Scheduled sync failed", e)
                needsReschedule = true
            } finally {
                if (!stopped) jobFinished(params, needsReschedule)
            }
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters?): Boolean {
        stopped = true
        return true
    }
}
