package org.mdmopen.dpc

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Fresh provisioning on some Samsung devices can temporarily expose the
 * Device Owner before WallpaperManager can read the current home wallpaper.
 * WallpaperBranding deliberately refuses to replace a customer's wallpaper
 * when it cannot read the real original, so retry that exact same branding
 * operation a few times after provisioning instead of giving up after the
 * first sync.
 *
 * This worker does not change the emblem asset, size, position or opacity.
 * It only retries WallpaperBranding.apply().
 */
class WallpaperBrandingRetryWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        val result = WallpaperBranding.apply(applicationContext)
        if (isTerminalSuccess(result)) return Result.success()

        // WorkManager attempt 0 is the first delayed retry. Six delayed
        // attempts cover the common post-provisioning settle window without
        // creating an endless background loop. A later normal sync can enqueue
        // a fresh retry chain if Samsung still was not ready.
        return if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) {
            Result.retry()
        } else {
            Result.success()
        }
    }

    companion object {
        private const val UNIQUE_WORK = "wallpaper-branding-after-enrollment"
        private const val MAX_RETRY_ATTEMPTS = 6
        private const val INITIAL_DELAY_SECONDS = 20L
        private const val BACKOFF_SECONDS = 20L

        fun scheduleIfNeeded(context: Context, firstResult: String) {
            if (isTerminalSuccess(firstResult)) return

            val request = OneTimeWorkRequestBuilder<WallpaperBrandingRetryWorker>()
                .setInitialDelay(INITIAL_DELAY_SECONDS, TimeUnit.SECONDS)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    BACKOFF_SECONDS,
                    TimeUnit.SECONDS,
                )
                .build()

            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                UNIQUE_WORK,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }

        internal fun isTerminalSuccess(result: String): Boolean {
            return result.contains("· OK ") || result.contains("· כבר מעודכן ·")
        }
    }
}
