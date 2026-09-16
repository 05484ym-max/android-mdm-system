package org.mdmopen.dpc

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Completes server enrollment after Android has already accepted the DPC
 * provisioning/compliance step.
 *
 * Android 16 / newer OEM setup wizards are less tolerant of long-running work
 * inside ACTION_ADMIN_POLICY_COMPLIANCE. Network enrollment and PolicySync must
 * therefore never block RESULT_OK from ProvisioningActivity.
 */
object PostProvisionEnrollmentScheduler {
    private const val UNIQUE_WORK = "post-provision-enrollment"

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<PostProvisionEnrollmentWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            UNIQUE_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}

class PostProvisionEnrollmentWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        val context = applicationContext
        val serverUrl = Config.serverUrl(context)
        val enrollmentToken = Config.pendingEnrollmentToken(context)

        // Nothing is pending. This also makes duplicate scheduling harmless.
        if (serverUrl.isBlank() || enrollmentToken.isNullOrBlank()) {
            return Result.success()
        }

        return try {
            val result = ApiClient(serverUrl).enroll(enrollmentToken)
            Config.setEnrollmentCredentials(
                context,
                result.deviceId,
                result.deviceToken,
            )
            Config.clearPendingEnrollmentToken(context)

            // Enrollment identity is durable before policy application. If sync
            // fails, normal sync scheduling can retry without losing identity.
            runCatching { PolicySync.run(context) }
                .onFailure { Log.w(TAG, "Initial post-provision policy sync failed", it) }

            runCatching { SyncScheduler.schedule(context) }
                .onFailure { Log.w(TAG, "Could not schedule normal sync after provisioning", it) }

            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Post-provision enrollment failed; WorkManager will retry", e)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "PostProvisionEnroll"
    }
}
