package org.mdmopen.dpc

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Failsafe for the very short Samsung accessibility setup window.
 *
 * CustomerActivity normally re-applies the package-only accessibility allowlist
 * after 1.5 seconds and again when it resumes. This worker is deliberately
 * independent of the Activity lifecycle so a process/activity death cannot leave
 * setPermittedAccessibilityServices(null) open indefinitely.
 */
class AccessibilityRelockWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        return try {
            val enforcer = PolicyEnforcer(applicationContext)
            if (enforcer.isDeviceOwner()) {
                enforcer.allowManagedAccessibilityService()
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
