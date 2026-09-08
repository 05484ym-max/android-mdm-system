package org.mdmopen.dpc

import android.app.job.JobScheduler
import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

object SyncScheduler {

    private const val LEGACY_JOB_ID = 1001
    private const val UNIQUE_PERIODIC_WORK = "policy-sync-periodic"
    private const val UNIQUE_PUSH_WORK = "policy-sync-push"
    private const val UNIQUE_RETRY_UPDATE_WORK = "policy-sync-retry-update"
    private const val UNIQUE_PUSH_TOKEN_WORK = "push-token-registration"
    private const val UNIQUE_ACCESSIBILITY_RELOCK_WORK = "accessibility-policy-relock"
    private const val MIN_INTERVAL_MINUTES = 15L

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /**
     * Keeps exactly one periodic policy sync. WorkManager survives reboot and
     * retries transient failures with backoff instead of relying on a raw thread.
     */
    fun schedule(context: Context) {
        val appContext = context.applicationContext

        // Clean up the old persisted JobScheduler entry after upgrading from the
        // legacy SyncJobService implementation.
        appContext.getSystemService(JobScheduler::class.java)?.cancel(LEGACY_JOB_ID)

        val minutes = Config.syncIntervalMinutes(appContext)
            .coerceAtLeast(MIN_INTERVAL_MINUTES.toInt())
            .toLong()

        val request = PeriodicWorkRequestBuilder<PolicySyncWorker>(
            minutes,
            TimeUnit.MINUTES,
        )
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    /** Coalesces bursts of FCM pushes while preserving an explicit retry-update. */
    fun enqueueImmediate(context: Context, retryUpdate: Boolean = false) {
        val appContext = context.applicationContext
        val request = OneTimeWorkRequestBuilder<PolicySyncWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(PolicySyncWorker.KEY_RETRY_UPDATE to retryUpdate))
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            if (retryUpdate) UNIQUE_RETRY_UPDATE_WORK else UNIQUE_PUSH_WORK,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    /**
     * Independent failsafe for Samsung accessibility setup. This intentionally
     * has no network constraint: its only job is to restore the local Device
     * Owner accessibility allowlist even if the Activity/process dies.
     */
    fun enqueueAccessibilityRelock(context: Context) {
        val appContext = context.applicationContext
        val request = OneTimeWorkRequestBuilder<AccessibilityRelockWorker>()
            .setInitialDelay(5, TimeUnit.MINUTES)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            UNIQUE_ACCESSIBILITY_RELOCK_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    /** The latest Firebase token wins; transient network failures are retried. */
    fun enqueuePushTokenRegistration(context: Context) {
        val appContext = context.applicationContext
        val request = OneTimeWorkRequestBuilder<PushTokenWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            UNIQUE_PUSH_TOKEN_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
