package org.mdmopen.dpc

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper

/**
 * Play Store is hidden by default, same as any app the customer hasn't been
 * approved for - so free browsing simply isn't reachable. Installing an
 * admin-approved app needs it briefly visible and launchable: this reveals it,
 * opens the install page, and hides it again once the window closes.
 *
 * This replaced an AccessibilityService-based guard that watched for the
 * customer opening Play Store on their own and kicked them out. That relied
 * on a Device Owner silently enabling an accessibility service via
 * setSecureSetting - blocked with a SecurityException on Android 11+, which
 * isn't documented on the API but reliably crashed every sync on this device.
 * setApplicationHidden needs no such special permission.
 */
object PlayStoreGate {
    const val ALLOW_WINDOW_MS = 180_000L
    private const val PACKAGE = "com.android.vending"

    fun openForInstall(context: Context, packageName: String) {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(context, DpcDeviceAdminReceiver::class.java)

        Config.setPlayStoreAllowedUntil(context, System.currentTimeMillis() + ALLOW_WINDOW_MS)
        dpm.setApplicationHidden(admin, PACKAGE, false)

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

        // Whoever's window is open last wins - if a newer install request already
        // extended the deadline, this stale callback must not re-hide early.
        Handler(Looper.getMainLooper()).postDelayed({
            if (isWindowClosed(context)) {
                dpm.setApplicationHidden(admin, PACKAGE, true)
            }
        }, ALLOW_WINDOW_MS)
    }

    fun isWindowClosed(context: Context): Boolean =
        Config.playStoreAllowedUntil(context) <= System.currentTimeMillis()
}
