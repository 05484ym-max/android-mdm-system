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
    private const val SCHEDULER_PREFS = "sync_scheduler_state"
    private const val KEY_SCHEDULED_INTERVAL = "scheduled_interval_minutes"

    private fun networkConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /**
     * Keeps exactly one periodic policy sync. WorkManager survives reboot and
     * retries transient failures with backoff instead of relying on a raw thread.
     */
    fun schedule(context: Context) {
        val appContext = context.applicationContext
        appContext.getSystemService(JobScheduler::class.java)?.cancel(LEGACY_JOB_ID)

        val minutes = Config.syncIntervalMinutes(appContext)
            .coerceAtLeast(MIN_INTERVAL_MINUTES.toInt())
            .toLong()

        val prefs = appContext.getSharedPreferences(SCHEDULER_PREFS, Context.MODE_PRIVATE)
        if (prefs.getLong(KEY_SCHEDULED_INTERVAL, -1L) == minutes) return

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
        prefs.edit().putLong(KEY_SCHEDULED_INTERVAL, minutes).apply()
    }

    /**
     * Push-triggered syncs are appended behind an already-running push sync
     * instead of KEEP-dropping the new request. This matters when a policy or
     * command changes while the current HTTP sync is already in flight: at
     * least one follow-up cycle is guaranteed to observe the newer server state.
     * WorkManager still serializes this unique chain, so PolicySync executions
     * do not run concurrently.
     */
    fun enqueueImmediate(context: Context, retryUpdate: Boolean = false) {
        val appContext = context.applicationContext
        val request = OneTimeWorkRequestBuilder<PolicySyncWorker>()
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(PolicySyncWorker.KEY_RETRY_UPDATE to retryUpdate))
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            if (retryUpdate) UNIQUE_RETRY_UPDATE_WORK else UNIQUE_PUSH_WORK,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }

    fun enqueueAccessibilityRelock(context: Context) {
        val appContext = context.applicationContext
        val relock = OneTimeWorkRequestBuilder<AccessibilityRelockWorker>()
            .setInitialDelay(5, TimeUnit.MINUTES)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(appContext).enqueueUniqueWork(
            UNIQUE_ACCESSIBILITY_RELOCK_WORK,
            ExistingWorkPolicy.REPLACE,
            relock,
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
