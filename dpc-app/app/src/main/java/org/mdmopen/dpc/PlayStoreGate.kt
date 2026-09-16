package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Opens one guarded Google Play install lease for one exact package.
 *
 * Android does not expose a package-scoped DISALLOW_INSTALL_APPS exception, so
 * PackageInstallGuardReceiver remains the security backstop. The customer-facing
 * PlayInstallBlockingActivity is deliberately a UI/security-hardening layer, not
 * the sole authorization boundary.
 */
object PlayStoreGate {
    private const val REVEAL_WINDOW_MS = 10_000L
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_INTERVAL_MS = 1_500L
    private const val PACKAGE = "com.android.vending"
    private const val TAG = "PlayStoreGate"
    private const val TIMEOUT_WORK = "play-install-hard-timeout"

    fun openForInstall(context: Context, packageName: String, displayName: String? = null) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        val appName = displayName ?: Config.appCatalog(appContext)
            .firstOrNull { it.packageName == packageName }
            ?.name ?: packageName
        val startingVersion = installedVersionCode(appContext, packageName)

        val deadline = System.currentTimeMillis() + REVEAL_WINDOW_MS + MAX_WAIT_MS
        val session = PlayInstallGuard.begin(appContext, packageName, deadline)
        PlayInstallStatusStore.begin(appContext, session.id, packageName, appName)

        try {
            Config.setPlayStoreAllowedUntil(appContext, deadline)
            dpm.setApplicationHidden(admin, PACKAGE, false)
            ManagedInstallWindow.open(appContext)
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
            // Do not fall back to an unrestricted browser URL. Failure closes the
            // temporary install lease before any customer-facing error is shown.
            failClosed(appContext, session.id, "Google Play לא זמין במכשיר")
            throw e
        }

        scheduleHardTimeout(appContext, deadline)

        Handler(Looper.getMainLooper()).postDelayed({
            if (!PlayInstallGuard.isActive(appContext, session.id)) return@postDelayed
            PlayInstallStatusStore.update(appContext, session.id, PlayInstallStage.WAITING)
            launchBlockingActivity(appContext)
            pollForInstall(
                appContext,
                packageName,
                session.id,
                admin,
                dpm,
                startingVersion,
                0L,
            )
        }, REVEAL_WINDOW_MS)
    }

    private fun installedVersionCode(context: Context, packageName: String): Long? = try {
        val info = context.packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION") info.versionCode.toLong()
        }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }

    private fun pollForInstall(
        context: Context,
        packageName: String,
        sessionId: String,
        admin: ComponentName,
        dpm: DevicePolicyManager,
        startingVersion: Long?,
        elapsedMs: Long,
    ) {
        if (!PlayInstallGuard.isActive(context, sessionId)) return

        val currentVersion = installedVersionCode(context, packageName)
        val done = if (startingVersion == null) currentVersion != null else
            currentVersion != null && currentVersion > startingVersion

        if (done) {
            completeTargetInstall(context, packageName, sessionId)
            return
        }

        if (elapsedMs >= MAX_WAIT_MS) {
            failClosed(context, sessionId, "זמן ההתקנה הסתיים. ההרשאה נסגרה אוטומטית")
            return
        }

        Handler(Looper.getMainLooper()).postDelayed({
            pollForInstall(
                context,
                packageName,
                sessionId,
                admin,
                dpm,
                startingVersion,
                elapsedMs + POLL_INTERVAL_MS,
            )
        }, POLL_INTERVAL_MS)
    }

    /** Receiver fast-path: the exact approved package emitted ADDED/REPLACED. */
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
        closePlayUi(context)
        PlayInstallStatusStore.update(
            context,
            sessionId,
            PlayInstallStage.COMPLETED,
            "$packageName הותקנה בהצלחה",
        )
        launchBlockingActivity(context)
    }

    /** Called only after PackageInstallGuardReceiver quarantines another package. */
    fun abortBecauseUnauthorizedInstall(context: Context, installedPackage: String) {
        val appContext = context.applicationContext
        val session = PlayInstallGuard.abortCurrent(appContext) ?: return

        Log.w(
            TAG,
            "Closing Play session ${session.id} because unauthorized package $installedPackage " +
                "was installed instead of ${session.targetPackage}",
        )

        ManagedInstallWindow.close(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(
            appContext,
            session.id,
            PlayInstallStage.FAILED,
            "זוהתה התקנה לא מאושרת. ההרשאה נסגרה מיד",
        )
        launchBlockingActivity(appContext)
    }

    /** Process-start recovery: an in-flight Play lease from a previous process is stale. */
    fun recoverAfterProcessStart(context: Context) {
        val appContext = context.applicationContext
        val snapshot = PlayInstallStatusStore.snapshot(appContext) ?: return
        if (snapshot.stage.terminal) return

        val session = PlayInstallGuard.abortCurrent(appContext)
        if (session != null) {
            ManagedInstallWindow.close(appContext)
        } else if (ManagedInstallWindow.isOpen(appContext)) {
            // Corrupt/missing ownership metadata is safer to close than to leave open.
            ManagedInstallWindow.forceClose(appContext)
        }
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(
            appContext,
            snapshot.sessionId,
            PlayInstallStage.FAILED,
            "ההתקנה הופסקה לאחר אתחול תהליך וההרשאה נסגרה",
        )
    }

    private fun failClosed(context: Context, sessionId: String, message: String) {
        val appContext = context.applicationContext
        val wasActive = PlayInstallGuard.finish(appContext, sessionId)
        if (wasActive) ManagedInstallWindow.close(appContext)
        Config.setPlayStoreAllowedUntil(appContext, System.currentTimeMillis())
        cancelHardTimeout(appContext)
        closePlayUi(appContext)
        PlayInstallStatusStore.update(appContext, sessionId, PlayInstallStage.FAILED, message)
        launchBlockingActivity(appContext)
    }

    private fun finishSession(context: Context, sessionId: String): Boolean {
        if (!PlayInstallGuard.finish(context, sessionId)) return false
        ManagedInstallWindow.close(context)
        Config.setPlayStoreAllowedUntil(context, System.currentTimeMillis())
        cancelHardTimeout(context)
        return true
    }

    private fun closePlayUi(context: Context) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        try {
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                dpm.setApplicationHidden(admin, PACKAGE, true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide Play Store while closing guarded install window", e)
        }
        InstallOverlay.hide(context)
    }

    private fun launchBlockingActivity(context: Context) {
        runCatching {
            context.startActivity(
                Intent(context, PlayInstallBlockingActivity::class.java)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT,
                    )
            )
        }.onFailure { Log.e(TAG, "Could not show Play install blocking UI", it) }
    }

    private fun scheduleHardTimeout(context: Context, deadline: Long) {
        val delayMs = (deadline - System.currentTimeMillis()).coerceAtLeast(1_000L)
        val request = OneTimeWorkRequestBuilder<PlayInstallTimeoutWorker>()
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            TIMEOUT_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    private fun cancelHardTimeout(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(TIMEOUT_WORK)
    }

    fun handleHardTimeout(context: Context) {
        val snapshot = PlayInstallStatusStore.snapshot(context) ?: return
        if (snapshot.stage.terminal) return
        // activeSession() clears expired guard state as a side effect, so timeout
        // cleanup must use the recovery path which also hides Play and closes any
        // remaining managed-install lease before marking the UI failed.
        recoverAfterProcessStart(context)
    }

    fun isWindowClosed(context: Context): Boolean =
        Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}

class PlayInstallTimeoutWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {
    override fun doWork(): Result = try {
        PlayStoreGate.handleHardTimeout(applicationContext)
        Result.success()
    } catch (e: Exception) {
        Log.e("PlayInstallTimeout", "Hard-timeout recovery failed", e)
        Result.retry()
    }
}
