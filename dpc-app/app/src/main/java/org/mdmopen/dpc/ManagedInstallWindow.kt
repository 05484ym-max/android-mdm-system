package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.UserManager
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Single source of truth for temporarily lifting DISALLOW_INSTALL_APPS.
 *
 * PackageInstaller checks the restriction when createSession() is called, so callers
 * must open this window before session creation. A small persisted reference count
 * keeps overlapping managed installs from closing the window under each other, and
 * a WorkManager failsafe restores the restriction if a callback is lost or the
 * process is killed after opening the window.
 */
object ManagedInstallWindow {
    private const val TAG = "ManagedInstallWindow"
    private const val PREFS = "dpc_managed_install_window"
    private const val KEY_ACTIVE = "active_operations"
    private const val RELOCK_WORK = "managed-install-relock"
    private const val FAILSAFE_MINUTES = 10L

    fun isOpen(context: Context): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_ACTIVE, 0) > 0

    @Synchronized
    fun open(context: Context) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) return

        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getInt(KEY_ACTIVE, 0).coerceAtLeast(0)

        if (current == 0) {
            dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        }
        check(prefs.edit().putInt(KEY_ACTIVE, current + 1).commit()) {
            "Could not persist managed-install window"
        }
        scheduleFailsafe(appContext)
    }

    @Synchronized
    fun close(context: Context) {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getInt(KEY_ACTIVE, 0).coerceAtLeast(0)
        val remaining = (current - 1).coerceAtLeast(0)
        prefs.edit().putInt(KEY_ACTIVE, remaining).commit()

        if (remaining == 0) {
            restoreRestriction(appContext)
            WorkManager.getInstance(appContext).cancelUniqueWork(RELOCK_WORK)
        }
    }

    /** Security recovery used after boot/package replacement and by the timeout worker. */
    @Synchronized
    fun forceClose(context: Context) {
        val appContext = context.applicationContext
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_ACTIVE, 0).commit()

        // Migrate stale flags left by older builds so upgrading cannot strand the
        // device with installs allowed indefinitely.
        appContext.getSharedPreferences("dpc_updater", Context.MODE_PRIVATE)
            .edit().putBoolean("install_in_progress", false).apply()
        appContext.getSharedPreferences("dpc_installer", Context.MODE_PRIVATE)
            .edit().putBoolean("install_temporarily_allowed", false).apply()

        restoreRestriction(appContext)
        WorkManager.getInstance(appContext).cancelUniqueWork(RELOCK_WORK)
    }

    fun recoverIfNeeded(context: Context) {
        val appContext = context.applicationContext
        val active = isOpen(appContext)
        val legacyUpdater = appContext.getSharedPreferences("dpc_updater", Context.MODE_PRIVATE)
            .getBoolean("install_in_progress", false)
        val legacyInstaller = appContext.getSharedPreferences("dpc_installer", Context.MODE_PRIVATE)
            .getBoolean("install_temporarily_allowed", false)
        if (active || legacyUpdater || legacyInstaller) {
            Log.w(TAG, "Recovering stale managed-install window")
            forceClose(appContext)
        }
    }

    private fun restoreRestriction(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        Log.i(TAG, "Install blocking restored")
    }

    private fun scheduleFailsafe(context: Context) {
        val request = OneTimeWorkRequestBuilder<ManagedInstallRelockWorker>()
            .setInitialDelay(FAILSAFE_MINUTES, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            RELOCK_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}

class ManagedInstallRelockWorker(
    appContext: Context,
    params: WorkerParameters,
) : Worker(appContext, params) {
    override fun doWork(): Result {
        return try {
            ManagedInstallWindow.forceClose(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
