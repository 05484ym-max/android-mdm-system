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

/**
 * Play Store is hidden by default, same as any app the customer hasn't been
 * approved for. A short approved-install window reveals it and takes an
 * install-permission lease from ManagedInstallWindow. Play Store never writes
 * DISALLOW_INSTALL_APPS directly; that restriction has one owner only.
 *
 * Because Android's install restriction is global rather than package-scoped,
 * every Play window is paired with PlayInstallGuard. If any newly-installed
 * package differs from the exact requested package, PackageInstallGuardReceiver
 * quarantines it and this gate immediately closes the Play window.
 */
object PlayStoreGate {
    private const val REVEAL_WINDOW_MS = 10_000L
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_INTERVAL_MS = 1_500L
    private const val PACKAGE = "com.android.vending"
    private const val TAG = "PlayStoreGate"

    fun openForInstall(context: Context, packageName: String, displayName: String? = null) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)

        val myDeadline = System.currentTimeMillis() + REVEAL_WINDOW_MS + MAX_WAIT_MS
        val session = PlayInstallGuard.begin(appContext, packageName, myDeadline)

        try {
            Config.setPlayStoreAllowedUntil(appContext, myDeadline)
            dpm.setApplicationHidden(admin, PACKAGE, false)
            ManagedInstallWindow.open(appContext)
        } catch (e: Exception) {
            PlayInstallGuard.clear(appContext, session.id)
            throw e
        }

        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
                    .setPackage(PACKAGE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            try {
                context.startActivity(
                    Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=$packageName"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                finishSession(appContext, session.id)
                closePlayUi(appContext, admin, dpm)
                throw e
            }
        }

        val appName = displayName ?: Config.appCatalog(appContext)
            .firstOrNull { it.packageName == packageName }
            ?.name ?: packageName

        val startingVersion = installedVersionCode(appContext, packageName)

        Handler(Looper.getMainLooper()).postDelayed({
            if (!PlayInstallGuard.isActive(appContext, session.id)) return@postDelayed
            InstallOverlay.show(appContext, appName)
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
        // An unauthorized-package receiver may already have consumed this
        // session and restored the install restriction. Never close the shared
        // lease twice from this older polling callback.
        if (!PlayInstallGuard.isActive(context, sessionId)) return

        val currentVersion = installedVersionCode(context, packageName)
        val done = if (startingVersion == null) currentVersion != null else
            currentVersion != null && currentVersion > startingVersion

        if (done || elapsedMs >= MAX_WAIT_MS) {
            if (finishSession(context, sessionId)) {
                closePlayUi(context, admin, dpm)
            }
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

    /** Called only by PackageInstallGuardReceiver after it has already hidden
     * and suspended the unauthorized package. Consumes exactly the active Play
     * lease, restores normal install blocking, hides Play, and returns Home. */
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

        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)
        closePlayUi(appContext, admin, dpm)
    }

    private fun finishSession(context: Context, sessionId: String): Boolean {
        if (!PlayInstallGuard.finish(context, sessionId)) return false
        ManagedInstallWindow.close(context)
        Config.setPlayStoreAllowedUntil(context, System.currentTimeMillis())
        return true
    }

    private fun closePlayUi(
        context: Context,
        admin: ComponentName,
        dpm: DevicePolicyManager,
    ) {
        try {
            context.startActivity(
                Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {}

        try {
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                dpm.setApplicationHidden(admin, PACKAGE, true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not hide Play Store while closing guarded install window", e)
        }

        InstallOverlay.hide(context)
    }

    fun isWindowClosed(context: Context): Boolean =
        Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}
