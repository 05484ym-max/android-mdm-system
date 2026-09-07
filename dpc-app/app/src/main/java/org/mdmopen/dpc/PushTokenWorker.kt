package org.mdmopen.dpc

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

/** Registers the latest FCM token with retry/backoff after transient failures. */
class PushTokenWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        return try {
            if (PushRegistration.ensureRegistered(applicationContext)) {
                Result.success()
            } else {
                Result.retry()
            }
        } catch (e: Exception) {
            Log.w(PolicySync.TAG, "Push token registration failed", e)
            Result.retry()
        }
    }
}
