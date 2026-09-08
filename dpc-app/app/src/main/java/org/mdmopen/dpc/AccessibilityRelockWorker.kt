package org.mdmopen.dpc

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Failsafe for the very short Samsung accessibility setup window.
 *
 * WhatsAppGuardService re-applies the package-only accessibility allowlist as
 * soon as Android confirms it is enabled, and CustomerActivity does so again on
 * return. This worker is deliberately
 * independent of the Activity lifecycle so a process/activity death cannot leave
 * setPermittedAccessibilityServices(null) open indefinitely.
 */
class AccessibilityRelockWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {

    override fun doWork(): Result {
        return try {
            // Timeout/failsafe only: if setup never properly finished (crash,
            // abandoned flow, WhatsAppGuardService never connected), clear the
            // setup-window state and force the allowlist back regardless.
            val enforcer = PolicyEnforcer(applicationContext)
            if (enforcer.isDeviceOwner()) {
                Config.setAccessibilitySetupWindowActive(applicationContext, false)
                enforcer.allowManagedAccessibilityService(force = true)
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
