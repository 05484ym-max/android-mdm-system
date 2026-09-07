package org.mdmopen.dpc

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Runs policy sync work under WorkManager so Android can retry/reschedule it safely. */
class PolicySyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        var syncFailed = false

        try {
            Log.i(PolicySync.TAG, "Background sync: ${PolicySync.run(applicationContext)}")
        } catch (e: Exception) {
            syncFailed = true
            Log.w(PolicySync.TAG, "Background sync failed", e)
        }

        // The explicit admin retry-update signal must still attempt an updater
        // check even when the policy sync itself failed. If sync succeeded,
        // PolicySync already requested the same signed update check and the
        // updater's AtomicBoolean prevents duplicate concurrent work.
        if (inputData.getBoolean(KEY_RETRY_UPDATE, false)) {
            try {
                AutoUpdater.check(applicationContext)
            } catch (e: Exception) {
                Log.w(PolicySync.TAG, "Retry-update check failed", e)
            }
        }

        return if (syncFailed) Result.retry() else Result.success()
    }

    companion object {
        const val KEY_RETRY_UPDATE = "retry_update"
    }
}
