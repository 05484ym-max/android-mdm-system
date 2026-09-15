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

/**
 * Play Store is hidden by default, same as any app the customer hasn't been
 * approved for. A short approved-install window reveals it and takes an
 * install-permission lease from ManagedInstallWindow. Play Store never writes
 * DISALLOW_INSTALL_APPS directly; that restriction has one owner only.
 */
object PlayStoreGate {
    private const val REVEAL_WINDOW_MS = 10_000L
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_INTERVAL_MS = 1_500L
    private const val PACKAGE = "com.android.vending"

    fun openForInstall(context: Context, packageName: String, displayName: String? = null) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)

        val myDeadline = System.currentTimeMillis() + REVEAL_WINDOW_MS + MAX_WAIT_MS
        Config.setPlayStoreAllowedUntil(appContext, myDeadline)
        dpm.setApplicationHidden(admin, PACKAGE, false)
        ManagedInstallWindow.open(appContext)

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
                ManagedInstallWindow.close(appContext)
                throw e
            }
        }

        val appName = displayName ?: Config.appCatalog(appContext)
            .firstOrNull { it.packageName == packageName }
            ?.name ?: packageName

        val startingVersion = installedVersionCode(appContext, packageName)

        Handler(Looper.getMainLooper()).postDelayed({
            InstallOverlay.show(appContext, appName)
            pollForInstall(appContext, packageName, admin, dpm, myDeadline, startingVersion, 0L)
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
        admin: ComponentName,
        dpm: DevicePolicyManager,
        myDeadline: Long,
        startingVersion: Long?,
        elapsedMs: Long,
    ) {
        val currentVersion = installedVersionCode(context, packageName)
        val done = if (startingVersion == null) currentVersion != null else
            currentVersion != null && currentVersion > startingVersion

        if (done || elapsedMs >= MAX_WAIT_MS) {
            // This request always releases exactly the lease it acquired. A
            // newer Play request or a silent installer may still hold another
            // lease, in which case ManagedInstallWindow keeps installs allowed.
            ManagedInstallWindow.close(context)

            // Only the newest Play window may hide the Store and dismiss the
            // shared overlay. An older callback must not close a newer window.
            if (Config.playStoreAllowedUntil(context) <= myDeadline) {
                context.startActivity(
                    Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_HOME)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                dpm.setApplicationHidden(admin, PACKAGE, true)
                InstallOverlay.hide(context)
            }
            return
        }

        Handler(Looper.getMainLooper()).postDelayed({
            pollForInstall(context, packageName, admin, dpm, myDeadline, startingVersion, elapsedMs + POLL_INTERVAL_MS)
        }, POLL_INTERVAL_MS)
    }

    fun isWindowClosed(context: Context): Boolean =
        Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}
