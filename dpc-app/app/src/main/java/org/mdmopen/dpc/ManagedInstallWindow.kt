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
 * Single source of truth for temporary install permission.
 *
 * Every path that temporarily needs DISALLOW_INSTALL_APPS lifted (silent APK,
 * self-update and Play Store) takes a reference-counted lease here. The current
 * server policy separately records whether installs should be blocked after all
 * leases close. This prevents a late PackageInstaller/Play callback from
 * re-blocking installs after Full Open was enabled, and prevents one installer
 * from closing another installer's window.
 */
object ManagedInstallWindow {
    private const val TAG = "ManagedInstallWindow"
    private const val PREFS = "dpc_managed_install_window"
    private const val KEY_ACTIVE = "active_operations"
    private const val KEY_DESIRED_BLOCKED = "desired_install_blocked"
    private const val RELOCK_WORK = "managed-install-relock"
    private const val FAILSAFE_MINUTES = 10L

    fun isOpen(context: Context): Boolean =
        prefs(context).getInt(KEY_ACTIVE, 0) > 0

    /** Called whenever a fresh server policy is received. */
    @Synchronized
    fun setDesiredInstallBlocked(context: Context, blocked: Boolean) {
        val appContext = context.applicationContext
        val preferences = prefs(appContext)
        check(preferences.edit().putBoolean(KEY_DESIRED_BLOCKED, blocked).commit()) {
            "Could not persist desired install restriction"
        }
        if (preferences.getInt(KEY_ACTIVE, 0).coerceAtLeast(0) == 0) {
            applyDesiredRestriction(appContext)
        } else {
            // A lease is active, so installs must remain temporarily allowed.
            clearRestriction(appContext)
        }
    }

    fun desiredInstallBlocked(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DESIRED_BLOCKED, true)

    @Synchronized
    fun open(context: Context) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) return

        val preferences = prefs(appContext)
        val current = preferences.getInt(KEY_ACTIVE, 0).coerceAtLeast(0)
        if (current == 0) clearRestriction(appContext)

        val persisted = preferences.edit().putInt(KEY_ACTIVE, current + 1).commit()
        if (!persisted) {
            if (current == 0) applyDesiredRestriction(appContext)
            error("Could not persist managed-install window")
        }
        scheduleFailsafe(appContext)
    }

    @Synchronized
    fun close(context: Context) {
        val appContext = context.applicationContext
        val preferences = prefs(appContext)
        val current = preferences.getInt(KEY_ACTIVE, 0).coerceAtLeast(0)
        val remaining = (current - 1).coerceAtLeast(0)
        if (!preferences.edit().putInt(KEY_ACTIVE, remaining).commit()) {
            Log.e(TAG, "Could not persist managed-install close; fail-safe remains armed")
            return
        }

        if (remaining == 0) {
            applyDesiredRestriction(appContext)
            WorkManager.getInstance(appContext).cancelUniqueWork(RELOCK_WORK)
        }
    }

    /**
     * Emergency stale-state recovery. This ends all temporary leases, but it
     * restores the *current desired policy* instead of blindly blocking.
     */
    @Synchronized
    fun forceClose(context: Context) {
        val appContext = context.applicationContext
        prefs(appContext).edit().putInt(KEY_ACTIVE, 0).commit()

        // Clean legacy state from the two pre-centralization implementations.
        appContext.getSharedPreferences("dpc_updater", Context.MODE_PRIVATE)
            .edit().putBoolean("install_in_progress", false).apply()
        appContext.getSharedPreferences("dpc_installer", Context.MODE_PRIVATE)
            .edit().putBoolean("install_temporarily_allowed", false).apply()

        applyDesiredRestriction(appContext)
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

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun clearRestriction(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
        Log.i(TAG, "Install permission lease active")
    }

    private fun applyDesiredRestriction(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (!dpm.isDeviceOwnerApp(context.packageName)) return
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)
        if (desiredInstallBlocked(context)) {
            dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
            Log.i(TAG, "Install blocking restored from desired policy")
        } else {
            dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
            Log.i(TAG, "Install blocking remains disabled by desired policy")
        }
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
