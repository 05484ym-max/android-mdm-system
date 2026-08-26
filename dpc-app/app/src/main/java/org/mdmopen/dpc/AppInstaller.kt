package org.mdmopen.dpc

import android.app.PendingIntent
import android.content.Context
import android.os.UserManager
import android.content.ComponentName
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.content.IntentSender
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Installs and removes apps through PackageInstaller. A Device Owner may do this
 * silently, which is what makes remote app management possible.
 */
class AppInstaller(private val context: Context) {

    fun installFromUrl(apkUrl: String, commandId: String? = null): String {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        )
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("dpc-install", 0, -1).use { output ->
                openApkStream(apkUrl).use { input -> input.copyTo(output) }
                session.fsync(output)
            }
            temporarilyAllowInstall()
            session.commit(statusSender(sessionId, commandId))
        }
        return "התקנה הופעלה מ-$apkUrl"
    }

    fun uninstall(packageName: String): String {
        context.packageManager.packageInstaller
            .uninstall(packageName, statusSender(packageName.hashCode()))
        return "הסרה הופעלה עבור $packageName"
    }


    private fun temporarilyAllowInstall() {
        val dpm =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        val admin =
            ComponentName(context, DpcDeviceAdminReceiver::class.java)

        dpm.clearUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_installer",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_temporarily_allowed", true)
            .apply()
    }

    fun restoreInstallBlock() {
        val dpm =
            context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        val admin =
            ComponentName(context, DpcDeviceAdminReceiver::class.java)

        dpm.addUserRestriction(
            admin,
            UserManager.DISALLOW_INSTALL_APPS
        )

        context.getSharedPreferences(
            "dpc_installer",
            Context.MODE_PRIVATE
        ).edit()
            .putBoolean("install_temporarily_allowed", false)
            .apply()
    }

    private fun openApkStream(apkUrl: String): InputStream {
        val url = URL(apkUrl)
        require(url.protocol == "https" || url.protocol == "http") {
            "סכמת URL לא נתמכת: ${url.protocol}"
        }
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("הורדת ה-APK נכשלה: HTTP ${connection.responseCode}")
        }
        return connection.inputStream
    }

    private fun statusSender(requestCode: Int, commandId: String? = null): IntentSender {
        val intent = Intent(context, InstallResultReceiver::class.java).apply {
            commandId?.let { putExtra("commandId", it) }
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags = flags or PendingIntent.FLAG_MUTABLE
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags).intentSender
    }
}
