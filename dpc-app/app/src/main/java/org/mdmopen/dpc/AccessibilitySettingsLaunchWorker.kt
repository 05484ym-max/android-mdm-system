package org.mdmopen.dpc

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.work.Worker
import androidx.work.WorkerParameters

/**
 * Samsung/One UI fallback for the WhatsApp Guard accessibility setup flow.
 *
 * CustomerActivity opens Accessibility immediately after releasing lock-task.
 * Some Samsung builds need a short framework/UI turn before nested Settings
 * becomes reachable. This worker performs a second best-effort launch after
 * that release has had time to settle. It never changes policy itself and it
 * only runs while the persisted setup window is still active.
 */
class AccessibilitySettingsLaunchWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {

    override fun doWork(): Result {
        val context = applicationContext
        if (!Config.accessibilitySetupWindowActive(context)) return Result.success()
        if (WhatsAppGuardProtection.accessibilityEnabled(context)) return Result.success()

        val attempts = listOf(
            Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )

        for (intent in attempts) {
            intent.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            if (intent.resolveActivity(context.packageManager) == null) continue
            try {
                context.startActivity(intent)
                return Result.success()
            } catch (_: Exception) {
                // Try the next, broader Settings fallback.
            }
        }

        return Result.success()
    }
}
