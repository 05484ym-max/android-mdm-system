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
import android.os.UserManager

/**
 * Play Store is hidden by default, same as any app the customer hasn't been
 * approved for - so free browsing simply isn't reachable. Installing an
 * admin-approved app needs it briefly visible and launchable: this reveals
 * it and opens the install page for just long enough for the one intended
 * tap (REVEAL_WINDOW_MS), then covers the screen with InstallOverlay so the
 * customer can't keep browsing Play Store while the install finishes, and
 * hides everything again the moment the target package is actually
 * installed (or MAX_WAIT_MS passes, whichever comes first).
 *
 * This replaced an AccessibilityService-based guard that watched for the
 * customer opening Play Store on their own and kicked them out. That relied
 * on a Device Owner silently enabling an accessibility service via
 * setSecureSetting - blocked with a SecurityException on Android 11+, which
 * isn't documented on the API but reliably crashed every sync on this device.
 * setApplicationHidden needs no such special permission.
 */
object PlayStoreGate {
    private const val REVEAL_WINDOW_MS = 10_000L
    private const val MAX_WAIT_MS = 120_000L
    private const val POLL_INTERVAL_MS = 1_500L
    private const val PACKAGE = "com.android.vending"

    /**
     * displayName overrides the catalog-name lookup below, for callers (like
     * a system-component command) whose package will never be in the
     * customer's app catalog - always a value the caller already trusts
     * (e.g. resolved server-side against a fixed allowlist), never raw
     * client input passed straight to a customer-facing overlay.
     */
    fun openForInstall(context: Context, packageName: String, displayName: String? = null) {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(appContext, DpcDeviceAdminReceiver::class.java)

        val myDeadline = System.currentTimeMillis() + REVEAL_WINDOW_MS + MAX_WAIT_MS
        Config.setPlayStoreAllowedUntil(appContext, myDeadline)
        dpm.setApplicationHidden(admin, PACKAGE, false)
        // DISALLOW_INSTALL_APPS blocks every install source, Play Store included -
        // without lifting it too, the customer sees the store but "Install" is a no-op.
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)

        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
                    .setPackage(PACKAGE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {
            context.startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=$packageName"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }

        val appName = displayName ?: Config.appCatalog(appContext)
            .firstOrNull { it.packageName == packageName }
            ?.name ?: packageName

        // For an already-installed app (checking for an update, not a fresh
        // install) "is it installed" is trivially already true - only a
        // version bump means the update actually landed.
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
            // Whoever's window is open last wins - if a newer install request
            // already pushed the deadline further out than this call's own,
            // this stale callback must not re-hide out from under it.
            if (Config.playStoreAllowedUntil(context) <= myDeadline) {
                // Hiding the app only stops it being launched again - Play
                // Store itself is still the running foreground activity
                // underneath the overlay, so removing the overlay alone just
                // reveals it again. Send the customer home first to actually
                // push it out of the foreground before it's suspended.
                context.startActivity(
                    Intent(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_HOME)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                dpm.setApplicationHidden(admin, PACKAGE, true)
                dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS)
            }
            InstallOverlay.hide(context)
            return
        }

        Handler(Looper.getMainLooper()).postDelayed({
            pollForInstall(context, packageName, admin, dpm, myDeadline, startingVersion, elapsedMs + POLL_INTERVAL_MS)
        }, POLL_INTERVAL_MS)
    }

    fun isWindowClosed(context: Context): Boolean =
        Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}
