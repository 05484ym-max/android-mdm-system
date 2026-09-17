package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

object PlayStoreGate {
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_INTERVAL_MS = 1_500L
    private const val PACKAGE = "com.android.vending"
    private const val TAG = "PlayStoreGate"
    private const val TIMEOUT_WORK = "play-install-hard-timeout"

    fun openForInstall(context: Context, packageName: String, displayName: String? = null) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        val appName = displayName ?: Config.appCatalog(appContext).firstOrNull { it.packageName == packageName }?.name ?: packageName
        val startingVersion = installedVersionCode(appContext, packageName)
        val deadline = System.currentTimeMillis() + MAX_WAIT_MS
        val session = PlayInstallGuard.begin(appContext, packageName, deadline)
        PlayInstallStatusStore.begin(appContext, session.id, packageName, appName)

        try {
            Config.setPlayStoreAllowedUntil(appContext, deadline)
            dpm.setApplicationHidden(admin, PACKAGE, false)
            ManagedInstallWindow.open(appContext)
            refreshKioskPolicy(appContext, failOnError = true)
        } catch (e: Exception) {
            failClosed(appContext, session.id, "לא ניתן היה לפתוח התקנה מאובטחת")
            throw e
        }

        try {
            appContext.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
                    .setPackage(PACKAGE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            PlayInstallStatusStore.update(appContext, session.id, PlayInstallStage.OPENING)
        } catch (e: Exception) {
            failClosed(appContext, session.id, "Google Play לא זמין במכשיר")
            throw e
        }

        // Protection and visual feedback start immediately. Keep the upper part
        // of Google Play visible so the customer sees Play's own real progress;
        // do not invent a percentage that Play does not expose to us.
        if (!InstallOverlay.show(appContext, appName)) {
            Log.w(TAG, "Partial install overlay unavailable; showing guarded fallback immediately")
            launchBlockingActivity(appContext)
        }
        PlayInstallStatusStore.update(appContext, session.id, PlayInstallStage.WAITING)
        scheduleHardTimeout(appContext, deadline)

        Handler(Looper.getMainLooper()).postDelayed({
            pollForInstall(appContext, packageName, session.id, startingVersion, 0L)
        }, 500L)
    }

    private fun installedVersionCode(context: Context, packageName: String): Long? =
        PlayCatalogUpdateState.installedVersionCode(context, packageName)

    private fun pollForInstall(context: Context, packageName: String, sessionId: String, startingVersion: Long?, elapsedMs: Long) {
        if (!PlayInstallGuard.isActive(context, sessionId)) return
        val currentVersion = installedVersionCode(context, packageName)
        val done = if (startingVersion == null) currentVersion != null else currentVersion != null && currentVersion > startingVersion
        if (done) {
            completeTargetInstall(context, packageName, sessionId)
            return
        }
        if (elapsedMs >= MAX_WAIT_MS) {
            // Public catalog metadata can advertise a rollout that Play does not
            // offer to this exact device. If the app is already installed,
            // acknowledge the current device version instead of trapping the
            // customer behind a false update forever.
            if (startingVersion != null && currentVersion != null) {
                completeAlreadyCurrent(context, packageName, sessionId)
            } else {
                failClosed(context, sessionId, "זמן ההתקנה הסתיים. ההרשאה נסגרה אוטומטית")
            }
            return
        }
        Handler(Looper.getMainLooper()).postDelayed({
            pollForInstall(context, packageName, sessionId, startingVersion, elapsedMs + POLL_INTERVAL_MS)
        }, POLL_INTERVAL_MS)
    }

    fun completeBecauseTargetInstalled(context: Context, changedPackage: String) {
        val appContext = context.applicationContext
        val session = PlayInstallGuard.activeSession(appContext) ?: return
        if (session.targetPackage != changedPackage) return
        completeTargetInstall(appContext, changedPackage, session.id)
    }

    private fun completeTargetInstall(context: Context, packageName: String, sessionId: String) {
        if (!PlayInstallGuard.isActive(context, sessionId)) return
        PlayInstallStatusStore.update(context, sessionId, PlayInstallStage.INSTALLING)
        if (!finishSession(context, sessionId)) return
        PlayCatalogUpdateState.acknowledgeInstalledVersion(context, packageName)
        closePlayUi(context)
        PlayInstallStatusStore.update(context, sessionId, PlayInstallStage.COMPLETED, "$packageName הותקנה בהצלחה")
        PlayInstallStatusStore.clear(context, sessionId)
        returnToCustomerStore(context)
    }

    private fun completeAlreadyCurrent(context: Context, packageName: String, sessionId: String) {
        if (!PlayInstallGuard.isActive(context, sessionId)) return
        if (!finishSession(context, sessionId)) return
        PlayCatalogUpdateState.acknowledgeInstalledVersion(context, packageName)
        closePlayUi(context)
        PlayInstallStatusStore.update(
            context,
            sessionId,
            PlayInstallStage.COMPLETED,
            "האפליקציה כבר מותקנת בגרסה הזמינה למכשיר זה"
        )
        PlayInstallStatusStore.clear(context, sessionId)
        returnToCustomerStore(context)
    }

    /** Safe escape hatch. It never leaves Google Play exposed. */
    fun cancelCurrentInstall(context: Context, message: String = "ההתקנה בוטלה וההרשאה נסגרה") {
        val appContext = context.applicationContext
        val snapshot = PlayInstallStatusStore.snapshot(appContext) ?: run {
            closePlayUi(appContext)
            return
        }
        if (snapshot.stage.terminal) return
        val session = PlayInstallGuard.abortCurrent(appContext)
        if (session != null) ManagedInstallWindow.close(appContext)
        else if (ManagedInstallWindow.isOpen(appContext)) ManagedInstallWindow.forceClose(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        refreshKioskPolicy(appContext)
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(appContext, snapshot.sessionId, PlayInstallStage.FAILED, message)
        PlayInstallStatusStore.clear(appContext, snapshot.sessionId)
    }

    fun abortBecauseUnauthorizedInstall(context: Context, installedPackage: String) {
        val appContext = context.applicationContext
        val session = PlayInstallGuard.abortCurrent(appContext) ?: return
        Log.w(TAG, "Closing Play session ${session.id} because unauthorized package $installedPackage was installed instead of ${session.targetPackage}")
        ManagedInstallWindow.close(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        refreshKioskPolicy(appContext)
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(appContext, session.id, PlayInstallStage.FAILED, "זוהתה התקנה לא מאושרת. ההרשאה נסגרה מיד")
        PlayInstallStatusStore.clear(appContext, session.id)
        returnToCustomerStore(appContext)
    }

    fun recoverAfterProcessStart(context: Context) {
        val appContext = context.applicationContext
        val snapshot = PlayInstallStatusStore.snapshot(appContext) ?: return
        if (snapshot.stage.terminal) return
        val session = PlayInstallGuard.abortCurrent(appContext)
        if (session != null) ManagedInstallWindow.close(appContext)
        else if (ManagedInstallWindow.isOpen(appContext)) ManagedInstallWindow.forceClose(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        refreshKioskPolicy(appContext)
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(appContext, snapshot.sessionId, PlayInstallStage.FAILED, "ההתקנה הופסקה וההרשאה נסגרה")
        PlayInstallStatusStore.clear(appContext, snapshot.sessionId)
    }

    private fun failClosed(context: Context, sessionId: String, message: String) {
        val appContext = context.applicationContext
        val wasActive = PlayInstallGuard.finish(appContext, sessionId)
        if (wasActive) ManagedInstallWindow.close(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        refreshKioskPolicy(appContext)
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(appContext, sessionId, PlayInstallStage.FAILED, message)
        PlayInstallStatusStore.clear(appContext, sessionId)
        returnToCustomerStore(appContext)
    }

    private fun finishSession(context: Context, sessionId: String): Boolean {
        if (!PlayInstallGuard.finish(context, sessionId)) return false
        ManagedInstallWindow.close(context)
        Config.setPlayStoreAllowedUntil(context, System.currentTimeMillis())
        refreshKioskPolicy(context)
        cancelHardTimeout(context)
        return true
    }

    private fun refreshKioskPolicy(context: Context, failOnError: Boolean = false) {
        try {
            val enforcer = PolicyEnforcer(context)
            if (enforcer.isDeviceOwner()) enforcer.restoreCachedKioskPolicy()
        } catch (e: Exception) {
            Log.e(TAG, "Could not refresh kiosk packages for Play install window", e)
            if (failOnError) throw e
        }
    }

    private fun launchBlockingActivity(context: Context) {
        runCatching {
            context.startActivity(
                Intent(context, PlayInstallBlockingActivity::class.java)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    )
            )
        }.onFailure { Log.e(TAG, "Could not show guarded install fallback", it) }
    }

    private fun closePlayUi(context: Context) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        try {
            if (dpm.isDeviceOwnerApp(context.packageName)) dpm.setApplicationHidden(admin, PACKAGE, true)
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide Play Store while closing guarded install window", e)
        }
        InstallOverlay.hide(context)
    }

    private fun returnToCustomerStore(context: Context) {
        runCatching {
            context.applicationContext.startActivity(
                Intent(context.applicationContext, CustomerActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            )
        }.onFailure { Log.e(TAG, "Could not return to customer store", it) }
    }

    private fun scheduleHardTimeout(context: Context, deadline: Long) {
        val delayMs = (deadline - System.currentTimeMillis()).coerceAtLeast(1_000L)
        val request = OneTimeWorkRequestBuilder<PlayInstallTimeoutWorker>().setInitialDelay(delayMs, TimeUnit.MILLISECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork(TIMEOUT_WORK, ExistingWorkPolicy.REPLACE, request)
    }

    private fun cancelHardTimeout(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(TIMEOUT_WORK)
    }

    fun handleHardTimeout(context: Context) {
        val snapshot = PlayInstallStatusStore.snapshot(context) ?: return
        if (snapshot.stage.terminal) return
        recoverAfterProcessStart(context)
    }

    fun isWindowClosed(context: Context): Boolean = Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}

class PlayInstallTimeoutWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {
    override fun doWork(): Result = try {
        PlayStoreGate.handleHardTimeout(applicationContext)
        Result.success()
    } catch (e: Exception) {
        Log.e("PlayInstallTimeout", "Hard-timeout recovery failed", e)
        Result.retry()
    }
}
